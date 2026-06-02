/**
 * PDF → ordered "blocks" for the task-extraction pipeline.
 *
 * Each block is one logical chunk of text from the document. Images and Loom
 * URLs that appear AFTER a block (per the user's rule "the image always follows
 * the text") are attached to that block. The downstream AI step turns each
 * block into a task; the attached images become task screenshots and the URLs
 * become per-task Loom links.
 *
 * Two PDF libraries are needed:
 *   - pdfjs-dist: text items with positions, URL annotations, image paint ops
 *     with their current-transform-matrix (so we know reading-order Y).
 *   - pdf-lib: raw image XObject bytes (DCT-encoded JPEG payloads ARE valid
 *     JPEG files — we can pull them straight out without re-encoding).
 */

import { PDFDocument, PDFRawStream, PDFName, PDFDict, PDFArray } from 'pdf-lib'
import { encodePngDataUrl } from './pngEncode'
// Deep imports — pdf-lib's public API doesn't expose individual filter streams.
// We chain them manually and stop at DCT/JPX/JBIG2/CCITT so the bytes we keep
// are a real image file (which pdf-lib's own decoder would throw on).
const { default: Stream } = require('pdf-lib/cjs/core/streams/Stream')
const { default: Ascii85Stream } = require('pdf-lib/cjs/core/streams/Ascii85Stream')
const { default: AsciiHexStream } = require('pdf-lib/cjs/core/streams/AsciiHexStream')
const { default: FlateStream } = require('pdf-lib/cjs/core/streams/FlateStream')
const { default: LZWStream } = require('pdf-lib/cjs/core/streams/LZWStream')
const { default: RunLengthStream } = require('pdf-lib/cjs/core/streams/RunLengthStream')

export interface PdfBlock {
  /** 1-based ordinal in the parsed document. The AI uses this to reference back. */
  index: number
  /** 1-based PDF page this block originated on. */
  page: number
  /** First line of the block — usually the natural title. */
  firstLine: string
  /** Full text of the block (firstLine + following lines, joined with newlines). */
  text: string
  /** Base64 data URLs for images that follow this block. */
  images: string[]
  /** Loom URLs (only) that follow this block. Other URLs are dropped — they aren't Loom links. */
  loomUrls: string[]
}

export interface PdfParseResult {
  blocks: PdfBlock[]
  pageCount: number
  /** Sanity-check counts. */
  stats: { textBlocks: number; images: number; loomUrls: number }
}

/**
 * Safety net for the AI step: the model returns each task's `source_block_index`,
 * and we attach that block's images to the task. But the model occasionally
 * reports a slightly wrong index or merges blocks, which would orphan a block's
 * images. This re-homes any images on a block that no task claimed onto the
 * nearest PRECEDING task (the task the image follows — matching the
 * Task → [image] layout), so no extracted screenshot is silently lost.
 *
 * Mutates `tasks` in place. Each task must have `source_block_index` and may
 * have a `screenshots` array (created if missing).
 */
export function attachUnclaimedBlockImages(
  tasks: Array<{ source_block_index?: number; screenshots?: any[]; image_base64?: string; image_url?: string }>,
  blocks: PdfBlock[],
): void {
  if (tasks.length === 0) return
  const claimed = new Set(tasks.map(t => t.source_block_index))
  const byIndexAsc = [...tasks].sort((a, b) => (a.source_block_index ?? 0) - (b.source_block_index ?? 0))

  for (const b of blocks) {
    if (b.images.length === 0 || claimed.has(b.index)) continue
    // Nearest task whose block is at/just before this one (the task it follows);
    // fall back to the very first task if the image precedes every task.
    let target: typeof byIndexAsc[number] | null = null
    for (const t of byIndexAsc) {
      if ((t.source_block_index ?? -1) <= b.index) target = t
      else break
    }
    if (!target) target = byIndexAsc[0]
    if (!target) continue
    target.screenshots = target.screenshots || []
    const start = target.screenshots.length
    b.images.forEach((dataUrl, i) => target!.screenshots!.push({
      timestamp_seconds: 0,
      timestamp_label: `Image ${start + i + 1}`,
      image_url: '',
      image_base64: dataUrl,
    }))
    if (!target.image_base64 && target.screenshots[0]) {
      target.image_base64 = target.screenshots[0].image_base64
      target.image_url = target.image_url || ''
    }
  }
}

const TERMINAL_IMAGE_FILTERS = new Set([
  '/DCTDecode', '/JPXDecode', '/JBIG2Decode', '/CCITTFaxDecode',
  '/DCT', '/JPX', '/CCF',
])

/**
 * Decode just enough of the PDF stream's filter chain to expose the image bytes.
 * Stops at DCT/JPX/JBIG2/CCITT so the result is a usable image file.
 */
function decodeImageStream(rawStream: any): { bytes: Uint8Array; terminalFilter: string | null } {
  const dict = rawStream.dict as PDFDict
  const filterObj = dict.lookup(PDFName.of('Filter'))
  let filters: string[] = []
  if (filterObj instanceof PDFArray) filters = filterObj.asArray().map((f: any) => f.toString())
  else if (filterObj) filters = [filterObj.toString()]

  let stream = new Stream(rawStream.contents)
  let terminalFilter: string | null = null
  for (const f of filters) {
    if (TERMINAL_IMAGE_FILTERS.has(f)) { terminalFilter = f; break }
    switch (f) {
      case '/ASCII85Decode': case '/A85': stream = new Ascii85Stream(stream); break
      case '/ASCIIHexDecode': case '/AHx': stream = new AsciiHexStream(stream); break
      case '/FlateDecode': case '/Fl': stream = new FlateStream(stream); break
      case '/LZWDecode': case '/LZW': stream = new LZWStream(stream); break
      case '/RunLengthDecode': case '/RL': stream = new RunLengthStream(stream); break
      default: throw new Error(`Unsupported PDF stream filter: ${f}`)
    }
  }
  const bytes = stream.getBytes() as Uint8Array
  return { bytes, terminalFilter }
}

/**
 * Resolve an image's colorspace to a renderable channel count (1 = gray, 3 = RGB),
 * or null for ones we don't re-encode (CMYK, Indexed, unknown). Handles the plain
 * device/cal names AND the common `[/ICCBased <stream>]` array form (e.g. macOS
 * screenshots), where the wrapped ICC stream's `/N` entry gives the component
 * count (1/3/4).
 */
function colorSpaceChannels(dict: PDFDict): 1 | 3 | null {
  const cs = dict.lookup(PDFName.of('ColorSpace'))
  if (!cs) return null

  // Array colorspace — we only re-encode ICCBased (resolve N from the profile).
  if (cs instanceof PDFArray) {
    const family = cs.lookup(0)?.toString()
    if (family === '/ICCBased') {
      const profile = cs.lookup(1)
      const n = profile && (profile as any).dict
        ? Number((profile as any).dict.lookup(PDFName.of('N'))?.toString())
        : NaN
      if (n === 1) return 1
      if (n === 3) return 3
    }
    return null // Indexed / CMYK ICC / Separation / etc.
  }

  const name = cs.toString()
  if (name === '/DeviceRGB' || name === '/RGB' || name === '/CalRGB') return 3
  if (name === '/DeviceGray' || name === '/G' || name === '/CalGray') return 1
  return null
}

/**
 * Re-encode RAW (already filter-decoded) image samples into a PNG data URL.
 * Handles the common screenshot case — 8-bit DeviceGray or DeviceRGB — which is
 * how non-JPEG images land here once FlateDecode has run. Returns null for
 * colorspaces/bit-depths we can't safely wrap (CMYK, Indexed, non-8-bit), which
 * the caller logs and skips. Soft-mask (alpha) is ignored — screenshots are
 * effectively opaque, so the RGB/Gray pixels render correctly.
 */
function rawSamplesToPngDataUrl(dict: PDFDict, bytes: Uint8Array): string | null {
  const num = (k: string): number | null => {
    const v = dict.lookup(PDFName.of(k))
    if (!v) return null
    const n = Number(v.toString())
    return Number.isFinite(n) ? n : null
  }
  const width = num('Width')
  const height = num('Height')
  const bpc = num('BitsPerComponent')
  if (!width || !height || bpc !== 8) return null

  const channels = colorSpaceChannels(dict)
  if (!channels) return null // CMYK / Indexed / unknown colorspaces — skip.

  if (bytes.length < width * height * channels) return null
  try {
    return encodePngDataUrl(width, height, channels, bytes)
  } catch {
    return null
  }
}

/** Mime type for the image bytes based on which terminal filter produced them. */
function imageMimeFor(terminalFilter: string | null, bytes: Uint8Array): string {
  if (terminalFilter === '/DCTDecode' || terminalFilter === '/DCT') return 'image/jpeg'
  if (terminalFilter === '/JPXDecode' || terminalFilter === '/JPX') return 'image/jp2'
  // Heuristic fallbacks for unfiltered streams.
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  return 'application/octet-stream'
}

/** Extract every image XObject from every page, in page → declaration order. */
function extractImageBytesByPage(pdfDoc: PDFDocument): Array<Array<{ dataUrl: string }>> {
  const out: Array<Array<{ dataUrl: string }>> = []
  pdfDoc.getPages().forEach((page) => {
    const pageImages: Array<{ dataUrl: string }> = []
    const resources = page.node.Resources()
    const xobjectsRaw = resources?.lookup(PDFName.of('XObject'))
    if (!(xobjectsRaw instanceof PDFDict)) { out.push(pageImages); return }
    for (const key of xobjectsRaw.keys()) {
      const stream = xobjectsRaw.lookup(key)
      if (!(stream instanceof PDFRawStream)) continue
      const subtype = stream.dict.lookup(PDFName.of('Subtype'))?.toString()
      if (subtype !== '/Image') continue
      try {
        const { bytes, terminalFilter } = decodeImageStream(stream)
        if (['/DCTDecode', '/DCT', '/JPXDecode', '/JPX'].includes(terminalFilter || '')) {
          // The kept bytes ARE a valid image file (JPEG/JP2) — use directly.
          const mime = imageMimeFor(terminalFilter, bytes)
          if (mime === 'application/octet-stream') {
            console.warn(`[pdfParser] Skipping image (unrecognized bytes after ${terminalFilter})`)
            continue
          }
          const b64 = Buffer.from(bytes).toString('base64')
          pageImages.push({ dataUrl: `data:${mime};base64,${b64}` })
        } else if (terminalFilter) {
          // JBIG2 / CCITT etc. — bitmap formats we can't show in a browser as-is.
          console.warn(`[pdfParser] Skipping image with unsupported filter ${terminalFilter}`)
        } else {
          // No terminal image filter: `bytes` are RAW samples (e.g. a PNG-style
          // FlateDecode screenshot). Re-encode to a real PNG when the colorspace
          // is supported; otherwise warn + skip (no silent loss).
          const pngUrl = rawSamplesToPngDataUrl(stream.dict, bytes)
          if (pngUrl) pageImages.push({ dataUrl: pngUrl })
          else console.warn('[pdfParser] Skipping image (unsupported raw colorspace/bit-depth)')
        }
      } catch (err) {
        // Skip un-decodable images rather than failing the whole upload.
        console.warn(`[pdfParser] Skipping image on page (decode failed):`, (err as Error).message)
      }
    }
    out.push(pageImages)
  })
  return out
}

/** Detect Loom URLs amid the page's annotation list. We don't attach other URLs. */
function isLoomUrl(u: string): boolean {
  return /loom\.com\/share\/[a-zA-Z0-9]+/.test(u)
}

interface OrderedItem {
  page: number      // 1-based
  y: number         // PDF y of the TOP edge — bigger = higher on page
  yBottom: number   // PDF y of the BOTTOM edge (paragraph last line / image base)
  kind: 'paragraph' | 'image' | 'loom'
  text?: string     // for paragraph
  imageIndex?: number  // index into pageImagesByPage[page-1]
  loomUrl?: string  // for loom
}

/**
 * Group same-line text items into lines, then lines separated by big y-gaps
 * into paragraphs. Returns paragraphs in top-to-bottom order with their top y.
 */
function paragraphsFromTextItems(items: any[]): Array<{ y: number; yBottom: number; text: string }> {
  if (items.length === 0) return []
  // Each item has transform [a, b, c, d, e, f] where (e, f) is the position.
  // We use f (y) and the item's str. Items without a transform (rare) get y=0.
  const positioned = items
    .map((it: any) => {
      const y = it.transform?.[5] ?? 0
      const x = it.transform?.[4] ?? 0
      const str = (it.str ?? '') as string
      const hasEOL = !!it.hasEOL
      return { y, x, str, hasEOL }
    })
    // PDF text-extraction order is already mostly correct; we sort by y desc (top first),
    // then x asc (left first) to be safe.
    .sort((a, b) => (b.y - a.y) || (a.x - b.x))

  // Group items into LINES: same y (within tolerance).
  const yTol = 2.0
  const lines: Array<{ y: number; texts: string[] }> = []
  for (const it of positioned) {
    const last = lines[lines.length - 1]
    if (last && Math.abs(last.y - it.y) <= yTol) {
      last.texts.push(it.str)
    } else {
      lines.push({ y: it.y, texts: [it.str] })
    }
  }

  // Materialize each line as a joined string. PDF text extraction usually emits
  // a trailing space between adjacent items; trust that and just concatenate.
  const flatLines = lines.map(l => ({ y: l.y, text: l.texts.join('').trim() })).filter(l => l.text.length > 0)

  // Group LINES into PARAGRAPHS: a paragraph break = a y-gap larger than the
  // typical line spacing on the page.
  if (flatLines.length === 0) return []
  // Estimate baseline gap from consecutive line y-deltas (median).
  const deltas: number[] = []
  for (let i = 1; i < flatLines.length; i++) deltas.push(flatLines[i - 1].y - flatLines[i].y)
  deltas.sort((a, b) => a - b)
  const medianDelta = deltas[Math.floor(deltas.length / 2)] || 12
  const paragraphBreak = medianDelta * 1.8  // a gap > ~2x the line height starts a new paragraph

  // "Screenshot — Page N …" caption lines sit very close to the task beneath
  // them, so plain y-gap grouping fuses the caption with the real task. Force a
  // caption line to be its own paragraph (and prevent the next line from merging
  // back into it) so the caption can be skipped as an image-attach target while
  // the task below stays a clean, separate block.
  const isCaptionLine = (t: string) => /^screenshot\b/i.test(t.trim())

  // Track the paragraph's TOP y (for sorting) AND the y of its most-recent line
  // (for gap detection — comparing to TOP y wrongly fragments long paragraphs).
  const paragraphs: Array<{ y: number; lastY: number; lines: string[] }> = []
  for (const line of flatLines) {
    const last = paragraphs[paragraphs.length - 1]
    const lineIsCaption = isCaptionLine(line.text)
    const lastIsCaption = last ? isCaptionLine(last.lines[0]) : false
    if (last && !lineIsCaption && !lastIsCaption) {
      const gap = last.lastY - line.y
      // Continuation if the gap is small. A line ending in sentence-final
      // punctuation can still continue if the next line is visually close —
      // some paragraphs span multiple short sentences. The break we really
      // care about is the visual gap between paragraphs in the PDF.
      if (gap <= paragraphBreak) {
        last.lines.push(line.text)
        last.lastY = line.y
        continue
      }
    }
    paragraphs.push({ y: line.y, lastY: line.y, lines: [line.text] })
  }

  // y = top of paragraph (for reading-order sort); yBottom = its last line
  // (for measuring the gap to an image sitting just below it).
  return paragraphs.map(p => ({ y: p.y, yBottom: p.lastY, text: p.lines.join('\n') }))
}

/**
 * For each paintImageXObject op, recover the page-Y of the painted image by
 * walking the operator stream while maintaining the current transform matrix.
 */
async function imagePaintYs(page: any, pdfjs: any): Promise<Array<{ y: number; h: number }>> {
  const ops = await page.getOperatorList()
  const OPS = pdfjs.OPS
  const paintImg = OPS.paintImageXObject
  const paintInline = OPS.paintInlineImageXObject

  // Track CTM stack. CTM is a 6-element affine matrix [a, b, c, d, e, f].
  // We only need the translation (e, f) for our position purposes.
  type Mat = [number, number, number, number, number, number]
  const identity = (): Mat => [1, 0, 0, 1, 0, 0]
  const stack: Mat[] = [identity()]
  const mul = (m1: Mat, m2: Mat): Mat => [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]

  const ys: Array<{ y: number; h: number }> = []
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    const args = ops.argsArray[i]
    if (fn === OPS.save) {
      stack.push([...stack[stack.length - 1]] as Mat)
    } else if (fn === OPS.restore) {
      if (stack.length > 1) stack.pop()
    } else if (fn === OPS.transform) {
      const top = stack[stack.length - 1]
      const m: Mat = [args[0], args[1], args[2], args[3], args[4], args[5]]
      stack[stack.length - 1] = mul(top, m)
    } else if (fn === paintImg || fn === paintInline) {
      // The image is painted into a unit square scaled by the CTM. f (m[5]) is
      // the BOTTOM edge in PDF coords (positive Y = up); the d component (m[3])
      // is the painted height, so bottom + height = the TOP edge.
      const top = stack[stack.length - 1]
      ys.push({ y: top[5], h: Math.abs(top[3]) })
    }
  }
  return ys
}

/**
 * Render the operator-tracked image-paint ys aligned with the per-page image
 * byte list (from pdf-lib). If counts mismatch we fall back to attaching by
 * declaration order without positions.
 */
function pairImagesWithPositions(
  pageImages: Array<{ dataUrl: string }>,
  paintYs: Array<{ y: number; h: number }>,
  pageNumber: number,
): OrderedItem[] {
  if (pageImages.length === 0) return []
  if (paintYs.length === pageImages.length) {
    return pageImages.map((img, i) => ({
      page: pageNumber,
      y: paintYs[i].y + paintYs[i].h,  // top edge
      yBottom: paintYs[i].y,           // base edge
      kind: 'image' as const,
      imageIndex: i,
    }))
  }
  // Mismatch: we can't position these reliably. Mark with y = -1 so the nearest
  // -block assignment treats them as position-unknown (attached as a page-level
  // fallback) rather than guessing a wrong location.
  return pageImages.map((img, i) => ({
    page: pageNumber,
    y: -1,
    yBottom: -1,
    kind: 'image' as const,
    imageIndex: i,
  }))
}

/** Page footer/header noise we strip from candidate blocks. */
function isPageNoise(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  // Page footers in various forms: "Page 3", "Page 3 of 16", "Page 3 of 16 (continued)".
  if (/^Page\s+\d+(\s+of\s+\d+)?(\s*\(continued\))?$/i.test(t)) return true
  // Single-glyph leftovers (e.g. arrow characters orphaned by text reflow).
  if (t.length <= 2 && !/[a-zA-Z0-9]/.test(t)) return true
  return false
}

const LOOM_URL_REGEX = /https?:\/\/(?:www\.)?loom\.com\/share\/[a-zA-Z0-9]+(?:\?[^\s)]*)?/g

/**
 * Pull Loom URLs out of a text block. Many PDFs paste Loom links as plain text
 * rather than clickable annotations — we want both.
 */
function extractLoomUrlsFromText(text: string): string[] {
  return Array.from(text.matchAll(LOOM_URL_REGEX), m => m[0])
}

/**
 * Parse a PDF buffer into ordered blocks.
 * Each text paragraph becomes one block; images and Loom URLs that appear after
 * a paragraph (in reading order) attach to that block.
 */
export async function parsePdfToBlocks(buffer: Buffer | Uint8Array): Promise<PdfParseResult> {
  // pdf-lib first — gives us image bytes per page.
  const pdfDoc = await PDFDocument.load(new Uint8Array(buffer))
  const imageBytesByPage = extractImageBytesByPage(pdfDoc)

  // pdfjs second — gives us text positions, link annotations, image positions.
  // Side-effect import of the worker module registers it in pdfjs's internal
  // state without needing GlobalWorkerOptions.workerSrc (which Turbopack
  // mangles at bundle time). This makes pdfjs run synchronously on the main
  // thread, which is what we want in a Node API route anyway.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // @ts-ignore — no type declarations for the worker module's side-effect import
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs')

  const loadingTask = (pdfjs as any).getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  })
  const pdfjsDoc = await loadingTask.promise
  const pageCount = pdfjsDoc.numPages

  // Build a flat reading-order stream across all pages.
  const stream: OrderedItem[] = []
  for (let p = 1; p <= pageCount; p++) {
    const page = await pdfjsDoc.getPage(p)
    const tc = await page.getTextContent()
    const paragraphs = paragraphsFromTextItems(tc.items)
    for (const para of paragraphs) {
      if (isPageNoise(para.text)) continue
      stream.push({ page: p, y: para.y, yBottom: para.yBottom, kind: 'paragraph', text: para.text })
    }

    // URL annotations.
    const annots = await page.getAnnotations()
    for (const a of annots) {
      if (a.subtype !== 'Link') continue
      const url = (a.url || a.unsafeUrl || '').trim()
      if (!isLoomUrl(url)) continue
      // rect = [x1, y1, x2, y2] — y2 is the top, y1 the bottom.
      const y = (a.rect && a.rect[3]) ?? 0
      const yBottom = (a.rect && a.rect[1]) ?? y
      stream.push({ page: p, y, yBottom, kind: 'loom', loomUrl: url })
    }

    // Images.
    const pageImages = imageBytesByPage[p - 1] || []
    if (pageImages.length > 0) {
      const ys = await imagePaintYs(page, pdfjs)
      stream.push(...pairImagesWithPositions(pageImages, ys, p))
    }
  }

  // Sort: page asc, y desc (top-first within page) = linear reading order.
  // Images use their TOP edge (set in pairImagesWithPositions) so each one sorts
  // immediately after the text block it follows.
  stream.sort((a, b) => (a.page - b.page) || (b.y - a.y))

  // The user's PDFs are laid out as: TASK text → [that task's image(s)] →
  // [its Loom link] → next TASK. So an image/Loom attaches to the most recent
  // REAL task block that PRECEDES it in reading order. We keep `lastRealBlock`
  // across page boundaries, so an image at the top of a page correctly attaches
  // to the task whose text ended on the previous page (e.g. the punch-out modal
  // screenshot that flows onto the next page still belongs to the Punch task).
  const isCaptionText = (text: string) => /^screenshot\b/i.test(text.trim())

  const blocks: PdfBlock[] = []
  let lastRealBlock: PdfBlock | null = null
  // Images/Loom that appear before ANY real task block (rare) — held and given
  // to the first real block so nothing is silently dropped.
  const pendingImages: string[] = []
  const pendingLoom: string[] = []
  const addLoom = (b: PdfBlock, url: string) => { if (!b.loomUrls.includes(url)) b.loomUrls.push(url) }

  let nextIndex = 1
  for (const item of stream) {
    if (item.kind === 'image') {
      const dataUrl = imageBytesByPage[item.page - 1]?.[item.imageIndex!]?.dataUrl
      if (!dataUrl) continue
      if (lastRealBlock) lastRealBlock.images.push(dataUrl)
      else pendingImages.push(dataUrl)
      continue
    }
    if (item.kind === 'loom') {
      if (!item.loomUrl) continue
      if (lastRealBlock) addLoom(lastRealBlock, item.loomUrl)
      else pendingLoom.push(item.loomUrl)
      continue
    }

    // paragraph
    const rawText = (item.text || '').trim()
    if (!rawText) continue
    const textLoomUrls = extractLoomUrlsFromText(rawText)
    const cleanText = rawText.replace(LOOM_URL_REGEX, '').replace(/\s{2,}/g, ' ').trim()
    if (!cleanText) {
      // URL-only paragraph — its Loom link belongs to the task above it.
      if (lastRealBlock) textLoomUrls.forEach(u => addLoom(lastRealBlock!, u))
      else pendingLoom.push(...textLoomUrls)
      continue
    }

    const block: PdfBlock = {
      index: nextIndex++,
      page: item.page,
      firstLine: cleanText.split('\n')[0].trim(),
      text: cleanText,
      images: [],
      loomUrls: textLoomUrls.slice(),  // URLs inline with the paragraph belong here
    }
    blocks.push(block)

    // Captions ("Screenshot — Page N …") are kept for AI context but never become
    // the attach target, so an image lands on the real task, not a caption.
    if (!isCaptionText(cleanText)) {
      if (pendingImages.length) { block.images.push(...pendingImages); pendingImages.length = 0 }
      if (pendingLoom.length) { pendingLoom.forEach(u => addLoom(block, u)); pendingLoom.length = 0 }
      lastRealBlock = block
    }
  }

  const totalImages = blocks.reduce((a, b) => a + b.images.length, 0)
  const totalLoom = blocks.reduce((a, b) => a + b.loomUrls.length, 0)

  return {
    blocks,
    pageCount,
    stats: { textBlocks: blocks.length, images: totalImages, loomUrls: totalLoom },
  }
}
