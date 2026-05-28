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
        // Skip JPX/JBIG2/CCITT (we can't usually display these as-is in browsers).
        // Most "screenshot in a PDF" cases are DCTDecode (JPEG).
        if (terminalFilter && !['/DCTDecode', '/DCT', '/JPXDecode', '/JPX'].includes(terminalFilter)) continue
        const mime = imageMimeFor(terminalFilter, bytes)
        if (mime === 'application/octet-stream') continue
        // Convert Uint8Array → base64 in Node.
        const b64 = Buffer.from(bytes).toString('base64')
        pageImages.push({ dataUrl: `data:${mime};base64,${b64}` })
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
  y: number         // PDF y — bigger = higher on page
  kind: 'paragraph' | 'image' | 'loom'
  text?: string     // for paragraph
  imageIndex?: number  // index into pageImagesByPage[page-1]
  loomUrl?: string  // for loom
}

/**
 * Group same-line text items into lines, then lines separated by big y-gaps
 * into paragraphs. Returns paragraphs in top-to-bottom order with their top y.
 */
function paragraphsFromTextItems(items: any[]): Array<{ y: number; text: string }> {
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

  // Track the paragraph's TOP y (for sorting) AND the y of its most-recent line
  // (for gap detection — comparing to TOP y wrongly fragments long paragraphs).
  const paragraphs: Array<{ y: number; lastY: number; lines: string[] }> = []
  for (const line of flatLines) {
    const last = paragraphs[paragraphs.length - 1]
    if (last) {
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

  return paragraphs.map(p => ({ y: p.y, text: p.lines.join('\n') }))
}

/**
 * For each paintImageXObject op, recover the page-Y of the painted image by
 * walking the operator stream while maintaining the current transform matrix.
 */
async function imagePaintYs(page: any, pdfjs: any): Promise<number[]> {
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

  const ys: number[] = []
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
      // The image is painted at the CTM origin. In PDF coords, this is the
      // BOTTOM-LEFT of the image (positive Y = up). Use that f-value as the
      // image's reading-order y.
      const top = stack[stack.length - 1]
      ys.push(top[5])
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
  paintYs: number[],
  pageNumber: number,
): OrderedItem[] {
  if (pageImages.length === 0) return []
  if (paintYs.length === pageImages.length) {
    return pageImages.map((img, i) => ({
      page: pageNumber,
      y: paintYs[i],
      kind: 'image' as const,
      imageIndex: i,
    }))
  }
  // Mismatch: assume painted-in-declaration-order. Attach without a meaningful y
  // (use a small y so they end up at the bottom of the page and attach to the
  // last block above). This is a safe degradation, not a failure.
  return pageImages.map((img, i) => ({
    page: pageNumber,
    y: 0,
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
      stream.push({ page: p, y: para.y, kind: 'paragraph', text: para.text })
    }

    // URL annotations.
    const annots = await page.getAnnotations()
    for (const a of annots) {
      if (a.subtype !== 'Link') continue
      const url = (a.url || a.unsafeUrl || '').trim()
      if (!isLoomUrl(url)) continue
      // rect = [x1, y1, x2, y2] — y2 is the top, use that.
      const y = (a.rect && a.rect[3]) ?? 0
      stream.push({ page: p, y, kind: 'loom', loomUrl: url })
    }

    // Images.
    const pageImages = imageBytesByPage[p - 1] || []
    if (pageImages.length > 0) {
      const ys = await imagePaintYs(page, pdfjs)
      stream.push(...pairImagesWithPositions(pageImages, ys, p))
    }
  }

  // Sort: page asc, y desc (top-first within page).
  stream.sort((a, b) => (a.page - b.page) || (b.y - a.y))

  // Walk the stream, attaching images/loom URLs to the most recent paragraph block.
  const blocks: PdfBlock[] = []
  let currentImages: string[] = []
  let currentLoom: string[] = []
  let last: PdfBlock | null = null
  const flushTo = (b: PdfBlock | null) => {
    if (!b) { currentImages = []; currentLoom = []; return }
    if (currentImages.length) b.images.push(...currentImages)
    if (currentLoom.length) b.loomUrls.push(...currentLoom)
    currentImages = []
    currentLoom = []
  }

  let nextIndex = 1
  for (const item of stream) {
    if (item.kind === 'paragraph') {
      // First, attach any pending image/url to the PREVIOUS block (the rule:
      // an image/url "follows" the most recent text). Then start a new block.
      flushTo(last)
      const rawText = (item.text || '').trim()
      if (!rawText) continue

      // Loom URLs pasted as plain text into the paragraph also attach to that
      // block. We strip them from the body text so the AI doesn't get noise.
      const textLoomUrls = extractLoomUrlsFromText(rawText)
      const cleanText = rawText.replace(LOOM_URL_REGEX, '').replace(/\s{2,}/g, ' ').trim()
      // If after URL stripping nothing meaningful remains, treat as URL-only —
      // attach the URLs to the previous block rather than create an empty one.
      if (!cleanText) {
        if (last) last.loomUrls.push(...textLoomUrls)
        continue
      }

      const firstLine = cleanText.split('\n')[0].trim()
      const block: PdfBlock = {
        index: nextIndex++,
        page: item.page,
        firstLine,
        text: cleanText,
        images: [],
        loomUrls: textLoomUrls.slice(),  // URLs inline with the paragraph belong here
      }
      blocks.push(block)
      last = block
    } else if (item.kind === 'image') {
      const pageImages = imageBytesByPage[item.page - 1]
      const img = pageImages?.[item.imageIndex!]
      if (img?.dataUrl) currentImages.push(img.dataUrl)
    } else if (item.kind === 'loom') {
      if (item.loomUrl) currentLoom.push(item.loomUrl)
    }
  }
  // Flush trailing attachments to the last block.
  flushTo(last)

  const totalImages = blocks.reduce((a, b) => a + b.images.length, 0)
  const totalLoom = blocks.reduce((a, b) => a + b.loomUrls.length, 0)

  return {
    blocks,
    pageCount,
    stats: { textBlocks: blocks.length, images: totalImages, loomUrls: totalLoom },
  }
}
