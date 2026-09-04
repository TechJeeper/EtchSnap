import type { SelectionPath } from '../types.ts'
import { rasterizeSelection, subtractSelectionRegions } from './selectionSubtract.ts'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function rect(x: number, y: number, width: number, height: number): SelectionPath {
  return {
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
    closed: true,
  }
}

function maskRect(
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
): Uint8Array {
  const mask = new Uint8Array(width * height)
  for (let py = y; py < y + rectHeight; py += 1) {
    for (let px = x; px < x + rectWidth; px += 1) {
      mask[py * width + px] = 1
    }
  }
  return mask
}

function countMask(mask: Uint8Array): number {
  let count = 0
  for (const value of mask) if (value) count += 1
  return count
}

function testSubtractPunchesHoleWithoutRefilling(): void {
  const width = 120
  const height = 80
  const existing: SelectionPath = {
    points: rect(10, 10, 100, 60).points,
    closed: true,
    mask: maskRect(width, height, 10, 10, 100, 60),
    maskWidth: width,
    maskHeight: height,
  }
  const cut: SelectionPath = {
    points: rect(50, 32, 16, 16).points,
    closed: true,
    mask: maskRect(width, height, 50, 32, 16, 16),
    maskWidth: width,
    maskHeight: height,
  }

  const { regions, removedPixelCount } = subtractSelectionRegions([existing], cut, width, height)

  assert(removedPixelCount === 16 * 16, 'cut pixels should be removed')
  assert(regions.length === 1, 'a hole should keep a single remaining region')

  const remaining = regions[0]
  assert(!!remaining.mask, 'remaining region should keep a pixel mask')
  assert(remaining.mask![32 * width + 58] === 0, 'the punched hole must stay empty')
  assert(remaining.mask![12 * width + 12] === 1, 'the outer selection should remain')
  assert(countMask(remaining.mask!) === 100 * 60 - 16 * 16, 'hole pixels must not be filled back in')
}

function testSubtractSplitsDisconnectedIslands(): void {
  const width = 140
  const height = 70
  const existing: SelectionPath = {
    points: rect(8, 8, 124, 50).points,
    closed: true,
    mask: maskRect(width, height, 8, 8, 124, 50),
    maskWidth: width,
    maskHeight: height,
  }
  const cut = rect(64, 8, 12, 50)

  const { regions, removedPixelCount } = subtractSelectionRegions([existing], cut, width, height)

  assert(removedPixelCount > 0, 'the dividing strip should be removed')
  assert(regions.length === 2, 'cutting a strip through the middle should leave two islands')
}

function testSubtractClearsWhenNothingRemains(): void {
  const existing = rect(10, 10, 40, 40)
  const cut = rect(8, 8, 50, 50)

  const { regions, removedPixelCount } = subtractSelectionRegions([existing], cut, 80, 80)

  assert(removedPixelCount > 0, 'overlapping cut should remove pixels')
  assert(regions.length === 0, 'subtracting the whole selection should clear it')
}

function testSmallHardwareCutIsApplied(): void {
  const width = 100
  const height = 80
  const existing: SelectionPath = {
    points: rect(5, 5, 90, 70).points,
    closed: true,
    mask: maskRect(width, height, 5, 5, 90, 70),
    maskWidth: width,
    maskHeight: height,
  }
  const cut: SelectionPath = {
    points: rect(48, 36, 10, 10).points,
    closed: true,
    mask: maskRect(width, height, 48, 36, 10, 10),
    maskWidth: width,
    maskHeight: height,
  }

  const { regions, removedPixelCount } = subtractSelectionRegions([existing], cut, width, height)

  assert(removedPixelCount === 100, 'a 10px hardware cut should still subtract')
  assert(regions[0]?.mask?.[40 * width + 53] === 0, 'the small cutout should be empty')
}

function testMissedCutLeavesSelectionUnchanged(): void {
  const existing = rect(10, 10, 40, 40)
  const cut = rect(70, 10, 20, 20)
  const original = rasterizeSelection([existing], 100, 80)

  const { regions, removedPixelCount } = subtractSelectionRegions([existing], cut, 100, 80)

  assert(removedPixelCount === 0, 'a miss should report no removed pixels')
  assert(regions.length === 1, 'the original region should be kept')
  const next = rasterizeSelection(regions, 100, 80)
  assert(countMask(next) === countMask(original), 'a miss should not change coverage')
}

function testPolygonCutWithoutMask(): void {
  const existing: SelectionPath = {
    points: rect(8, 8, 80, 60).points,
    closed: true,
    mask: maskRect(100, 80, 8, 8, 80, 60),
    maskWidth: 100,
    maskHeight: 80,
  }
  const cut = rect(36, 28, 18, 18)

  const { regions, removedPixelCount } = subtractSelectionRegions([existing], cut, 100, 80)

  assert(removedPixelCount > 100, 'an outlined cut should subtract its interior')
  assert(regions[0]?.mask?.[36 * 100 + 44] === 0, 'the traced cutout should be empty')
}

testSubtractPunchesHoleWithoutRefilling()
testSubtractSplitsDisconnectedIslands()
testSubtractClearsWhenNothingRemains()
testSmallHardwareCutIsApplied()
testMissedCutLeavesSelectionUnchanged()
testPolygonCutWithoutMask()

console.log('selectionSubtract tests passed')
