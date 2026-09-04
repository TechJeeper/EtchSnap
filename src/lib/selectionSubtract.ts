import type { Point, SelectionPath } from '../types'

const EIGHT_DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const
const CARDINAL_DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

const MIN_COMPONENT_BOUNDS = 24
const MIN_COMPONENT_PIXELS = 48
const MIN_POINTS = 3

export function rasterizeSelection(
  regions: SelectionPath[],
  width: number,
  height: number,
): Uint8Array {
  const mask = new Uint8Array(width * height)
  for (const region of regions) {
    stampRegion(mask, region, width, height)
  }
  return mask
}

export function subtractSelectionRegions(
  existing: SelectionPath[],
  cut: SelectionPath,
  width: number,
  height: number,
): { regions: SelectionPath[]; removedPixelCount: number } {
  if (existing.length === 0 || width < 1 || height < 1) {
    return { regions: existing, removedPixelCount: 0 }
  }

  const remaining = rasterizeSelection(existing, width, height)
  const cutMask = new Uint8Array(width * height)
  stampRegion(cutMask, cut, width, height)

  let removedPixelCount = 0
  for (let index = 0; index < remaining.length; index += 1) {
    if (!remaining[index] || !cutMask[index]) continue
    remaining[index] = 0
    removedPixelCount += 1
  }

  if (removedPixelCount === 0) {
    return { regions: existing, removedPixelCount: 0 }
  }

  return {
    regions: extractComponents(remaining, width, height),
    removedPixelCount,
  }
}

function stampRegion(
  dest: Uint8Array,
  region: SelectionPath,
  width: number,
  height: number,
): void {
  if (region.mask && region.maskWidth && region.maskHeight) {
    stampScaledMask(dest, width, height, region.mask, region.maskWidth, region.maskHeight)
    return
  }

  if (region.points.length < MIN_POINTS) return

  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0
  for (const point of region.points) {
    minX = Math.min(minX, Math.floor(point.x))
    minY = Math.min(minY, Math.floor(point.y))
    maxX = Math.max(maxX, Math.ceil(point.x))
    maxY = Math.max(maxY, Math.ceil(point.y))
  }

  minX = Math.max(0, minX)
  minY = Math.max(0, minY)
  maxX = Math.min(width - 1, maxX)
  maxY = Math.min(height - 1, maxY)

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (pointInPolygon({ x: x + 0.5, y: y + 0.5 }, region.points)) {
        dest[y * width + x] = 1
      }
    }
  }
}

function stampScaledMask(
  dest: Uint8Array,
  destWidth: number,
  destHeight: number,
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
): void {
  if (sourceWidth === destWidth && sourceHeight === destHeight) {
    for (let index = 0; index < dest.length; index += 1) {
      if (source[index]) dest[index] = 1
    }
    return
  }

  for (let y = 0; y < destHeight; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.round((y * sourceHeight) / destHeight))
    for (let x = 0; x < destWidth; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.round((x * sourceWidth) / destWidth))
      if (source[sourceY * sourceWidth + sourceX]) {
        dest[y * destWidth + x] = 1
      }
    }
  }
}

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const start = polygon[j]
    const end = polygon[i]
    const intersects =
      start.y > point.y !== end.y > point.y &&
      point.x < ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x
    if (intersects) inside = !inside
  }

  return inside
}

function extractComponents(mask: Uint8Array, width: number, height: number): SelectionPath[] {
  const visited = new Uint8Array(mask.length)
  const queue = new Int32Array(mask.length)
  const regions: SelectionPath[] = []

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue

    const component = new Uint8Array(mask.length)
    let head = 0
    let tail = 0
    let pixels = 0
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0

    queue[tail++] = start
    visited[start] = 1

    while (head < tail) {
      const index = queue[head++]
      component[index] = 1
      pixels += 1

      const x = index % width
      const y = Math.floor(index / width)
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)

      for (const [dx, dy] of EIGHT_DIRECTIONS) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const neighbor = ny * width + nx
        if (!mask[neighbor] || visited[neighbor]) continue
        visited[neighbor] = 1
        queue[tail++] = neighbor
      }
    }

    const boundsWidth = maxX - minX + 1
    const boundsHeight = maxY - minY + 1
    if (
      pixels < MIN_COMPONENT_PIXELS ||
      boundsWidth < MIN_COMPONENT_BOUNDS ||
      boundsHeight < MIN_COMPONENT_BOUNDS
    ) {
      continue
    }

    const region = regionFromMask(component, width, height)
    if (region) regions.push(region)
  }

  return regions
}

function regionFromMask(mask: Uint8Array, width: number, height: number): SelectionPath | null {
  const boundary = traceBoundary(mask, width, height)
  if (boundary.length < MIN_POINTS) return null

  const epsilon = boundary.length > 400 ? 4.5 : boundary.length > 180 ? 3.5 : 2.5
  const points = simplifyPath(boundary, epsilon)
  if (points.length < MIN_POINTS) return null

  return {
    points,
    closed: true,
    mask,
    maskWidth: width,
    maskHeight: height,
  }
}

function isBoundaryPixel(
  mask: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): boolean {
  if (!mask[y * width + x]) return false

  for (const [dx, dy] of CARDINAL_DIRECTIONS) {
    const nx = x + dx
    const ny = y + dy
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return true
    if (!mask[ny * width + nx]) return true
  }

  return false
}

function traceBoundary(mask: Uint8Array, width: number, height: number): Point[] {
  let startX = -1
  let startY = -1

  outer: for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isBoundaryPixel(mask, width, height, x, y)) {
        startX = x
        startY = y
        break outer
      }
    }
  }

  if (startX === -1) return []

  const directions = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ]

  const contour: Point[] = []
  let x = startX
  let y = startY
  let direction = 0
  const maxSteps = width * height * 4

  for (let step = 0; step < maxSteps; step += 1) {
    contour.push({ x, y })

    let found = false
    for (let offset = 0; offset < 8; offset += 1) {
      const nextDirection = (direction + offset + 5) % 8
      const [dx, dy] = directions[nextDirection]
      const nx = x + dx
      const ny = y + dy

      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      if (!isBoundaryPixel(mask, width, height, nx, ny)) continue

      x = nx
      y = ny
      direction = nextDirection
      found = true
      break
    }

    if (!found) break
    if (x === startX && y === startY && contour.length > 8) break
  }

  return contour
}

function perpendicularDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x
  const dy = end.y - start.y

  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y)
  }

  const numerator = Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x)
  const denominator = Math.hypot(dx, dy)
  return numerator / denominator
}

function simplifyPath(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points

  let maxDistance = 0
  let index = 0
  const end = points.length - 1

  for (let i = 1; i < end; i += 1) {
    const distance = perpendicularDistance(points[i], points[0], points[end])
    if (distance > maxDistance) {
      maxDistance = distance
      index = i
    }
  }

  if (maxDistance > epsilon) {
    const left = simplifyPath(points.slice(0, index + 1), epsilon)
    const right = simplifyPath(points.slice(index), epsilon)
    return [...left.slice(0, -1), ...right]
  }

  return [points[0], points[end]]
}
