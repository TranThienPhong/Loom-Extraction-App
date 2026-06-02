/**
 * Minimal, dependency-free PNG encoder (pure JS + Node's zlib).
 *
 * The PDF parser pulls JPEG (DCTDecode) image bytes straight out of the file,
 * but PNG-style screenshots are stored as raw, Flate-compressed samples — not a
 * standalone image file. After the filter chain decodes them we have raw pixel
 * bytes, which this re-wraps into a real PNG so the browser/jsPDF can render it.
 *
 * Supports 8-bit Gray (1 channel), RGB (3), and RGBA (4). That covers the common
 * "screenshot pasted into a doc" cases; exotic colorspaces (CMYK, Indexed) are
 * handled by the caller (skip + warn).
 */

import { deflateSync } from 'zlib'

// CRC32 (PNG polynomial 0xEDB88320), with a lazily-built lookup table.
let CRC_TABLE: number[] | null = null
function crcTable(): number[] {
  if (CRC_TABLE) return CRC_TABLE
  const t: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  CRC_TABLE = t
  return t
}
function crc32(buf: Buffer): number {
  const t = crcTable()
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/**
 * Encode raw 8-bit samples (row-major, no padding) into a PNG buffer.
 * @param channels 1 = gray, 3 = RGB, 4 = RGBA.
 */
export function encodePng(width: number, height: number, channels: 1 | 3 | 4, samples: Uint8Array): Buffer {
  const colorType = channels === 1 ? 0 : channels === 3 ? 2 : 6
  const expected = width * height * channels
  if (samples.length < expected) {
    throw new Error(`encodePng: not enough sample bytes (have ${samples.length}, need ${expected})`)
  }

  // IHDR
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8)          // bit depth
  ihdr.writeUInt8(colorType, 9)  // color type
  ihdr.writeUInt8(0, 10)         // compression
  ihdr.writeUInt8(0, 11)         // filter
  ihdr.writeUInt8(0, 12)         // interlace

  // Image data: each scanline prefixed with filter-type byte 0 (None).
  const stride = width * channels
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(samples.buffer, samples.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const idat = deflateSync(raw)

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Convenience: encode and wrap as a base64 data URL. */
export function encodePngDataUrl(width: number, height: number, channels: 1 | 3 | 4, samples: Uint8Array): string {
  return `data:image/png;base64,${encodePng(width, height, channels, samples).toString('base64')}`
}
