// Rasterises public/icon.svg's shapes to the PNG sizes Chrome's install prompt wants, with no
// image library: rounded rectangles are drawn from their signed distance and the PNG is
// assembled by hand on top of node's zlib. Run: npm run icons
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const SIZES = [192, 512]
const CANVAS = 64
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

/** [x, y, width, height, cornerRadius, rgb] on the 64-unit canvas — the same shapes as icon.svg. */
const SHAPES = [
  [0, 0, 64, 64, 14, [0x1a, 0x1c, 0x20]],
  [14, 16, 36, 32, 7, [0xf5, 0xb0, 0x43]],
  [20, 21, 24, 18, 4, [0xff, 0xd2, 0x8a]],
]

/** Antialiased coverage of a point by a rounded rectangle: 1 inside, 0 outside, a one-pixel ramp between. */
const coverage = (px, py, [x, y, w, h, r], pixelsPerUnit) => {
  const dx = Math.max(Math.abs(px - (x + w / 2)) - (w / 2 - r), 0)
  const dy = Math.max(Math.abs(py - (y + h / 2)) - (h / 2 - r), 0)
  const distance = Math.hypot(dx, dy) - r
  return Math.min(Math.max(0.5 - distance * pixelsPerUnit, 0), 1)
}

const render = (size) => {
  const pixelsPerUnit = size / CANVAS
  const rgba = Buffer.alloc(size * size * 4)
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const px = (col + 0.5) / pixelsPerUnit
      const py = (row + 0.5) / pixelsPerUnit
      let [red, green, blue, alpha] = [0, 0, 0, 0]
      for (const shape of SHAPES) {
        const a = coverage(px, py, shape, pixelsPerUnit)
        const [r, g, b] = shape[5]
        red = red * (1 - a) + r * a
        green = green * (1 - a) + g * a
        blue = blue * (1 - a) + b * a
        alpha = alpha + a * (1 - alpha)
      }
      rgba.set([red, green, blue, alpha * 255].map(Math.round), (row * size + col) * 4)
    }
  }
  return rgba
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (bytes) => {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

const png = (size, rgba) => {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 6, 0, 0, 0], 8)   // 8-bit RGBA, no interlace
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)   // each row starts with filter byte 0
  for (let row = 0; row < size; row++) rgba.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const size of SIZES) {
  const file = join(OUT_DIR, `icon-${size}.png`)
  writeFileSync(file, png(size, render(size)))
  console.log('wrote', file)
}
