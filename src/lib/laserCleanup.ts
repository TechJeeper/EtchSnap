import type { PixelImage } from './isolateArtwork.ts'

const INK_ALPHA = 30

function isInk(data: Uint8ClampedArray, index: number): boolean {
  if (data[index + 3] < INK_ALPHA) return false
  return 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2] < 140
}

function clearPixel(data: Uint8ClampedArray, index: number): void {
  data[index] = 0
  data[index + 1] = 0
  data[index + 2] = 0
  data[index + 3] = 0
}

export function despeckleInk(image: PixelImage, minArea = 16): number {
  const { width, height, data } = image
  const seen = new Uint8Array(width * height)
  let removed = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x
      if (seen[start] || !isInk(data, start * 4)) continue

      const stack = [start]
      const pixels: number[] = []
      seen[start] = 1

      while (stack.length > 0) {
        const i = stack.pop()
        if (i === undefined) break
        pixels.push(i)
        const cx = i % width
        const cy = Math.floor(i / width)
        const next = [i - 1, i + 1, i - width, i + width]
        const valid = [cx > 0, cx + 1 < width, cy > 0, cy + 1 < height]
        for (let n = 0; n < 4; n += 1) {
          if (!valid[n]) continue
          const ni = next[n]
          if (seen[ni] || !isInk(data, ni * 4)) continue
          seen[ni] = 1
          stack.push(ni)
        }
      }

      if (pixels.length >= minArea) continue
      for (const i of pixels) {
        clearPixel(data, i * 4)
        removed += 1
      }
    }
  }

  return removed
}

export function cleanupLaserInk(image: PixelImage): void {
  const minArea = Math.max(16, Math.round(image.width * image.height * 0.00008))
  despeckleInk(image, minArea)
}
