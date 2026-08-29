import type { PixelImage } from './isolateArtwork.ts'

const INK_ALPHA = 30
export const LASER_INK_MAX_LUMINANCE = 168

function isInk(data: Uint8ClampedArray, index: number): boolean {
  if (data[index + 3] < INK_ALPHA) return false
  return 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2] < LASER_INK_MAX_LUMINANCE
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
        const next = [
          i - 1,
          i + 1,
          i - width,
          i + width,
          i - width - 1,
          i - width + 1,
          i + width - 1,
          i + width + 1,
        ]
        const valid = [
          cx > 0,
          cx + 1 < width,
          cy > 0,
          cy + 1 < height,
          cx > 0 && cy > 0,
          cx + 1 < width && cy > 0,
          cx > 0 && cy + 1 < height,
          cx + 1 < width && cy + 1 < height,
        ]
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

function paintInk(data: Uint8ClampedArray, index: number): void {
  data[index] = 0
  data[index + 1] = 0
  data[index + 2] = 0
  data[index + 3] = 255
}

function compactness(pixels: number[], width: number, height: number): number {
  const inSet = new Uint8Array(width * height)
  for (const i of pixels) inSet[i] = 1

  let perimeter = 0
  for (const i of pixels) {
    const x = i % width
    const y = Math.floor(i / width)
    if (x === 0 || !inSet[i - 1]) perimeter += 1
    if (x + 1 >= width || !inSet[i + 1]) perimeter += 1
    if (y === 0 || !inSet[i - width]) perimeter += 1
    if (y + 1 >= height || !inSet[i + width]) perimeter += 1
  }

  if (perimeter === 0) return 1
  return (4 * Math.PI * pixels.length) / (perimeter * perimeter)
}

function enclosedLooksLikeCutLines(image: PixelImage, exterior: Uint8Array): boolean {
  const { width, height, data } = image
  const seen = new Uint8Array(width * height)
  let enclosed = 0
  let lineLike = 0

  for (let start = 0; start < width * height; start += 1) {
    if (seen[start] || exterior[start] || isInk(data, start * 4)) continue

    const stack = [start]
    const pixels: number[] = []
    seen[start] = 1

    while (stack.length > 0) {
      const i = stack.pop()
      if (i === undefined) break
      pixels.push(i)
      const x = i % width
      const y = Math.floor(i / width)
      const next = [i - 1, i + 1, i - width, i + width]
      const valid = [x > 0, x + 1 < width, y > 0, y + 1 < height]
      for (let n = 0; n < 4; n += 1) {
        if (!valid[n]) continue
        const ni = next[n]
        if (seen[ni] || exterior[ni] || isInk(data, ni * 4)) continue
        seen[ni] = 1
        stack.push(ni)
      }
    }

    enclosed += pixels.length
    if (compactness(pixels, width, height) < 0.22) lineLike += pixels.length
  }

  return enclosed > 0 && lineLike / enclosed >= 0.5
}

function inkLooksLikeStrokes(image: PixelImage, exterior: Uint8Array): boolean {
  const { width, height, data } = image
  const seen = new Uint8Array(width * height)
  let ink = 0
  let lineLike = 0
  let largest = 0

  for (let start = 0; start < width * height; start += 1) {
    if (seen[start] || exterior[start] || !isInk(data, start * 4)) continue

    const stack = [start]
    const pixels: number[] = []
    seen[start] = 1

    while (stack.length > 0) {
      const i = stack.pop()
      if (i === undefined) break
      pixels.push(i)
      const x = i % width
      const y = Math.floor(i / width)
      const next = [i - 1, i + 1, i - width, i + width]
      const valid = [x > 0, x + 1 < width, y > 0, y + 1 < height]
      for (let n = 0; n < 4; n += 1) {
        if (!valid[n]) continue
        const ni = next[n]
        if (seen[ni] || exterior[ni] || !isInk(data, ni * 4)) continue
        seen[ni] = 1
        stack.push(ni)
      }
    }

    ink += pixels.length
    largest = Math.max(largest, pixels.length)
    if (compactness(pixels, width, height) < 0.22) lineLike += pixels.length
  }

  const interior = width * height - countExterior(exterior)
  if (interior > 0 && largest / interior > 0.4) return false
  return ink > 0 && lineLike / ink >= 0.45
}

function enclosedLooksLikeSpeckle(image: PixelImage, exterior: Uint8Array): boolean {
  const { width, height, data } = image
  const seen = new Uint8Array(width * height)
  const areas: number[] = []

  for (let start = 0; start < width * height; start += 1) {
    if (seen[start] || exterior[start] || isInk(data, start * 4)) continue

    const stack = [start]
    let area = 0
    seen[start] = 1

    while (stack.length > 0) {
      const i = stack.pop()
      if (i === undefined) break
      area += 1
      const x = i % width
      const y = Math.floor(i / width)
      const next = [i - 1, i + 1, i - width, i + width]
      const valid = [x > 0, x + 1 < width, y > 0, y + 1 < height]
      for (let n = 0; n < 4; n += 1) {
        if (!valid[n]) continue
        const ni = next[n]
        if (seen[ni] || exterior[ni] || isInk(data, ni * 4)) continue
        seen[ni] = 1
        stack.push(ni)
      }
    }

    areas.push(area)
  }

  if (areas.length < 12) return false
  areas.sort((a, b) => a - b)
  const median = areas[Math.floor(areas.length / 2)]
  const interior = width * height - countExterior(exterior)
  return median < Math.max(6, interior * 0.008)
}

function countExterior(exterior: Uint8Array): number {
  let count = 0
  for (const value of exterior) if (value) count += 1
  return count
}

export function normalizeLaserPolarity(image: PixelImage, fillThreshold = 0.45): boolean {
  const { width, height, data } = image
  const exterior = markExterior(image)
  let interior = 0
  let ink = 0

  for (let i = 0; i < width * height; i += 1) {
    if (exterior[i]) continue
    interior += 1
    if (isInk(data, i * 4)) ink += 1
  }

  const enclosed = interior - ink
  if (interior === 0 || enclosed / interior < 0.05) return false
  if (ink / interior <= fillThreshold) return false
  if (inkLooksLikeStrokes(image, exterior)) return false
  if (
    !enclosedLooksLikeCutLines(image, exterior) &&
    !enclosedLooksLikeSpeckle(image, exterior)
  ) {
    return false
  }

  invertLaserInterior(image)
  return true
}

function markExterior(image: PixelImage): Uint8Array {
  const { width, height, data } = image
  const exterior = new Uint8Array(width * height)
  const stack: number[] = []

  const tryPush = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const i = y * width + x
    if (exterior[i] || isInk(data, i * 4)) return
    exterior[i] = 1
    stack.push(i)
  }

  for (let x = 0; x < width; x += 1) {
    tryPush(x, 0)
    tryPush(x, height - 1)
  }
  for (let y = 0; y < height; y += 1) {
    tryPush(0, y)
    tryPush(width - 1, y)
  }

  while (stack.length > 0) {
    const i = stack.pop()
    if (i === undefined) break
    const x = i % width
    const y = Math.floor(i / width)
    tryPush(x - 1, y)
    tryPush(x + 1, y)
    tryPush(x, y - 1)
    tryPush(x, y + 1)
  }

  return exterior
}

export function invertLaserInterior(image: PixelImage): void {
  const { width, height, data } = image
  const exterior = markExterior(image)

  for (let i = 0; i < width * height; i += 1) {
    if (exterior[i]) {
      clearPixel(data, i * 4)
      continue
    }
    if (isInk(data, i * 4)) clearPixel(data, i * 4)
    else paintInk(data, i * 4)
  }
}

function patternedEmptyRun(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  alongX: boolean,
): number {
  const matches = (cx: number, cy: number): boolean => {
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) return false
    const index = (cy * width + cx) * 4
    if (isInk(data, index)) return false
    if (alongX) {
      if (cy === 0 || cy + 1 >= height) return false
      return isInk(data, (index - width * 4)) && isInk(data, (index + width * 4))
    }
    if (cx === 0 || cx + 1 >= width) return false
    return isInk(data, index - 4) && isInk(data, index + 4)
  }

  if (!matches(x, y)) return 0
  let count = 1
  if (alongX) {
    for (let cx = x - 1; matches(cx, y); cx -= 1) count += 1
    for (let cx = x + 1; matches(cx, y); cx += 1) count += 1
  } else {
    for (let cy = y - 1; matches(x, cy); cy -= 1) count += 1
    for (let cy = y + 1; matches(x, cy); cy += 1) count += 1
  }
  return count
}

const MAX_STROKE_GAP = 3

export function bridgeInkGaps(image: PixelImage): number {
  const { width, height, data } = image
  const toFill: number[] = []

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x
      if (isInk(data, i * 4)) continue
      const left = isInk(data, (i - 1) * 4)
      const right = isInk(data, (i + 1) * 4)
      const up = isInk(data, (i - width) * 4)
      const down = isInk(data, (i + width) * 4)
      const horizontalDash = left && right && !up && !down
      const verticalDash = up && down && !left && !right
      if (horizontalDash && patternedEmptyRun(data, width, height, x, y, false) <= MAX_STROKE_GAP) {
        toFill.push(i)
      } else if (verticalDash && patternedEmptyRun(data, width, height, x, y, true) <= MAX_STROKE_GAP) {
        toFill.push(i)
      }
    }
  }

  for (const i of toFill) paintInk(data, i * 4)
  return toFill.length
}

export interface CleanupLaserOptions {
  polarity?: boolean
}

export function cleanupLaserInk(image: PixelImage, options: CleanupLaserOptions = {}): void {
  const polarity = options.polarity !== false
  despeckleInk(image, 8)
  if (polarity) normalizeLaserPolarity(image)
  bridgeInkGaps(image)
  despeckleInk(image, 8)
}
