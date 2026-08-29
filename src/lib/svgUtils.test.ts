import { flattenLaserTracePaper, sanitizeSvg } from './svgUtils.ts'
import type { PixelImage } from './isolateArtwork.ts'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function createImage(width: number, height: number): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255
    data[i + 1] = 255
    data[i + 2] = 255
    data[i + 3] = 255
  }
  return { data, width, height }
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
  const i = (y * image.width + x) * 4
  return image.data[i + 3] > 30 && image.data[i] < 20
}

function countInk(image: PixelImage): number {
  let count = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (isInk(image, x, y)) count += 1
    }
  }
  return count
}

function testFlattenKeepsWhitePaperAroundLineArt(): void {
  const image = createImage(40, 16)
  fillInkRect(image, 2, 4, 36, 2)
  fillInkRect(image, 2, 10, 36, 2)
  flattenLaserTracePaper(image.data)
  const ink = countInk(image)
  assert(ink < 40 * 16 * 0.35, `trace paper must stay white around strokes, ink ${ink}`)
  assert(isInk(image, 10, 4), 'stroke pixels should stay ink')
  assert(!isInk(image, 10, 7), 'gap between strokes must not become a black plate')
  assert(!isInk(image, 1, 1), 'white paper around the design must stay white')
}

function testFlattenKeepsDashedSpeckleFromPng(): void {
  const image = createImage(20, 8)
  paintInk(image, 2, 2)
  paintInk(image, 3, 2)
  paintInk(image, 10, 4)
  paintInk(image, 16, 6)
  flattenLaserTracePaper(image.data)
  assert(isInk(image, 2, 2) && isInk(image, 3, 2), 'short dashes from the PNG must stay ink')
  assert(isInk(image, 10, 4), 'isolated marks from the PNG must stay ink')
  assert(isInk(image, 16, 6), 'isolated marks from the PNG must stay ink')
  assert(!isInk(image, 5, 5), 'paper around speckle must stay white')
}

function testLaserSvgPunchesHolesAndDropsStroke(): void {
  const svg = [
    '<svg width="10" height="10">',
    '<path fill="rgb(0,0,0)" stroke="rgb(0,0,0)" stroke-width="0" d="M 0 0 L 10 0 L 10 10 L 0 10 Z M 3 3 L 7 3 L 7 7 L 3 7 Z" />',
    '<path fill="rgb(255,255,255)" d="M 0 0 L 10 0 L 10 10 L 0 10 Z" />',
    '</svg>',
  ].join('')

  const out = sanitizeSvg(svg, 10, 10, 5, 5, 'laser')
  assert(/fill-rule="evenodd"/.test(out), 'laser paths must use evenodd so holes punch through')
  assert(/stroke="none"/.test(out), 'laser paths must not keep a matching stroke that fills the shape')
  assert(!/rgb\(255,\s*255,\s*255\)/.test(out), 'white background paths must be removed')
  assert(/viewBox="0 0 10 10"/.test(out), 'viewBox should keep traced coordinates')
  assert(/width="5"/.test(out) && /height="5"/.test(out), 'display size should stay at the original crop')
}

const tests = [
  ['flatten keeps white paper around line art', testFlattenKeepsWhitePaperAroundLineArt],
  ['flatten keeps dashed speckle from png', testFlattenKeepsDashedSpeckleFromPng],
  ['laser svg punches holes and drops stroke', testLaserSvgPunchesHolesAndDropsStroke],
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
console.log(`\n${tests.length - failed}/${tests.length} svg utils tests passed`)
