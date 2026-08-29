import { cleanupLaserInk, despeckleInk, normalizeLaserPolarity } from './laserCleanup.ts'
import type { PixelImage } from './isolateArtwork.ts'

function createImage(width: number, height: number): PixelImage {
  return {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
  }
}

function paintInk(image: PixelImage, x: number, y: number): void {
  const i = (y * image.width + x) * 4
  image.data[i] = 0
  image.data[i + 1] = 0
  image.data[i + 2] = 0
  image.data[i + 3] = 255
}

function fillInkRect(
  image: PixelImage,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      paintInk(image, px, py)
    }
  }
}

function isInk(image: PixelImage, x: number, y: number): boolean {
  return image.data[(y * image.width + x) * 4 + 3] > 30
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function testDespeckleRemovesDustKeepsShape(): void {
  const image = createImage(40, 20)
  fillInkRect(image, 4, 4, 20, 12)
  paintInk(image, 36, 2)
  paintInk(image, 37, 2)
  paintInk(image, 36, 17)
  despeckleInk(image, 8)
  assert(isInk(image, 10, 8), 'large ink shape should survive despeckle')
  assert(!isInk(image, 36, 2), 'isolated specks should be removed')
  assert(!isInk(image, 36, 17), 'isolated specks should be removed')
}

function clearInk(image: PixelImage, x: number, y: number, width: number, height: number): void {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      const i = (py * image.width + px) * 4
      image.data[i + 3] = 0
    }
  }
}

function testCleanupKeepsSeparateShapesApart(): void {
  const image = createImage(24, 8)
  fillInkRect(image, 2, 3, 8, 2)
  fillInkRect(image, 12, 3, 8, 2)
  cleanupLaserInk(image)
  assert(!isInk(image, 10, 3) && !isInk(image, 11, 3), 'nearby separate shapes must not fuse together')
  assert(isInk(image, 4, 4), 'original stroke should remain')
}

function testNormalizeInvertsFilledShapeWithCutLines(): void {
  const image = createImage(40, 24)
  fillInkRect(image, 4, 4, 32, 16)
  for (let y = 8; y <= 16; y += 2) {
    for (let x = 8; x <= 30; x += 1) clearInk(image, x, y, 1, 1)
  }
  assert(normalizeLaserPolarity(image), 'a filled plate with cut linework should invert')
  assert(!isInk(image, 6, 6), 'former fill should become transparent')
  assert(isInk(image, 12, 8), 'former cut lines should become ink')
  assert(!isInk(image, 1, 1), 'exterior should stay transparent')
}

function testNormalizeLeavesSolidMotifWithHole(): void {
  const image = createImage(40, 24)
  fillInkRect(image, 4, 4, 32, 16)
  clearInk(image, 10, 8, 8, 8)
  assert(!normalizeLaserPolarity(image), 'a solid motif with a compact hole should stay positive')
  assert(isInk(image, 6, 6), 'motif fill should stay ink')
  assert(!isInk(image, 14, 12), 'compact hole should stay empty')
}

function testNormalizeInvertsSpeckledPlate(): void {
  const image = createImage(48, 32)
  fillInkRect(image, 4, 4, 40, 24)
  for (let y = 8; y <= 24; y += 3) {
    for (let x = 8; x <= 40; x += 3) clearInk(image, x, y, 1, 1)
  }
  assert(normalizeLaserPolarity(image), 'a filled plate with speckled cutouts should invert')
  assert(!isInk(image, 6, 6), 'former fill should become transparent')
  assert(isInk(image, 8, 8), 'former specks should become ink')
}

function testNormalizeLeavesLineArtAlone(): void {
  const image = createImage(40, 24)
  fillInkRect(image, 8, 6, 24, 2)
  fillInkRect(image, 8, 16, 24, 2)
  assert(!normalizeLaserPolarity(image), 'open line art should not invert')
  assert(isInk(image, 12, 6), 'line art strokes should stay ink')
}

const tests = [
  ['despeckle removes dust keeps shape', testDespeckleRemovesDustKeepsShape],
  ['cleanup keeps separate shapes apart', testCleanupKeepsSeparateShapesApart],
  ['normalize inverts filled shape with cut lines', testNormalizeInvertsFilledShapeWithCutLines],
  ['normalize inverts speckled plate', testNormalizeInvertsSpeckledPlate],
  ['normalize leaves solid motif with hole', testNormalizeLeavesSolidMotifWithHole],
  ['normalize leaves line art alone', testNormalizeLeavesLineArtAlone],
] as const

let failed = 0
for (const [name, run] of tests) {
  try {
    run()
    console.log(`ok  ${name}`)
  } catch (error) {
    failed += 1
    console.error(`fail  ${name}`)
    console.error(error instanceof Error ? error.message : error)
  }
}

if (failed > 0) process.exit(1)
console.log(`\n${tests.length - failed}/${tests.length} laser-cleanup tests passed`)
