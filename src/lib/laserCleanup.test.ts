import { cleanupLaserInk, despeckleInk } from './laserCleanup.ts'
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

function testCleanupJoinsBrokenStroke(): void {
  const image = createImage(24, 8)
  fillInkRect(image, 2, 3, 8, 2)
  fillInkRect(image, 11, 3, 8, 2)
  cleanupLaserInk(image)
  assert(isInk(image, 10, 3) || isInk(image, 10, 4), '1px gap in a stroke should close')
  assert(isInk(image, 4, 4), 'original stroke should remain')
}

const tests = [
  ['despeckle removes dust keeps shape', testDespeckleRemovesDustKeepsShape],
  ['cleanup joins broken stroke', testCleanupJoinsBrokenStroke],
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
