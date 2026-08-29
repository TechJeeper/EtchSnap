import { magicWandSelection } from './magicWand.ts'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function createImageData(width: number, height: number): ImageData {
  return {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
    colorSpace: 'srgb',
  } as ImageData
}

function fillRect(
  image: ImageData,
  x: number,
  y: number,
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
): void {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      const index = (py * image.width + px) * 4
      image.data[index] = r
      image.data[index + 1] = g
      image.data[index + 2] = b
      image.data[index + 3] = 255
    }
  }
}

function setPixel(image: ImageData, x: number, y: number, r: number, g: number, b: number): void {
  const index = (y * image.width + x) * 4
  image.data[index] = r
  image.data[index + 1] = g
  image.data[index + 2] = b
  image.data[index + 3] = 255
}

function createNoisyMetalBar(): ImageData {
  const image = createImageData(280, 140)
  fillRect(image, 0, 0, 280, 140, 168, 92, 198)

  for (let y = 40; y < 100; y += 1) {
    for (let x = 36; x < 244; x += 1) {
      const noise = ((x * 37 + y * 17) % 13) - 6
      const shade = 42 + noise + Math.floor((x - 36) / 40)
      setPixel(image, x, y, shade, shade, shade + 4)
    }
  }

  // Specular glints that currently hijack the seed color
  setPixel(image, 120, 68, 250, 250, 255)
  setPixel(image, 121, 68, 238, 240, 255)
  setPixel(image, 120, 69, 230, 232, 246)
  setPixel(image, 180, 72, 255, 255, 255)

  return image
}

function maskIoU(a: Uint8Array, b: Uint8Array): number {
  let inter = 0
  let union = 0
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ? 1 : 0
    const bv = b[i] ? 1 : 0
    inter += av & bv
    union += av | bv
  }
  return union === 0 ? 1 : inter / union
}

function countMask(mask: Uint8Array): number {
  let count = 0
  for (const value of mask) if (value) count += 1
  return count
}

function testNearbyClicksOnNoisyBarStayStable(): void {
  const image = createNoisyMetalBar()
  const clicks = [
    [80, 70],
    [83, 71],
    [110, 68],
    [160, 74],
    [200, 66],
  ] as const

  const hits = clicks.map(([x, y]) => magicWandSelection(image, x, y, { colorTolerance: 32 }))
  for (let i = 0; i < hits.length; i += 1) {
    assert(!!hits[i], `click ${clicks[i].join(',')} should select the bar`)
  }

  const base = hits[0]!
  const barArea = 208 * 60
  assert(countMask(base.mask) > barArea * 0.72, 'center click should fill most of the bar')

  for (let i = 1; i < hits.length; i += 1) {
    const iou = maskIoU(base.mask, hits[i]!.mask)
    assert(
      iou >= 0.82,
      `nearby click ${clicks[i].join(',')} should match the center fill, IoU ${iou.toFixed(3)}`,
    )
  }
}

function testSpecularClickDoesNotCollapseFill(): void {
  const image = createNoisyMetalBar()
  const matte = magicWandSelection(image, 80, 70, { colorTolerance: 32 })
  const glint = magicWandSelection(image, 120, 68, { colorTolerance: 32 })
  assert(!!matte, 'matte click should select')
  assert(!!glint, 'glint click should still select the bar, not fail')
  const iou = maskIoU(matte!.mask, glint!.mask)
  assert(iou >= 0.8, `glint click should not collapse the fill, IoU ${iou.toFixed(3)}`)
}

function testObjectDoesNotLeakIntoBackground(): void {
  const image = createNoisyMetalBar()
  const hit = magicWandSelection(image, 90, 70, { colorTolerance: 32 })
  assert(!!hit, 'bar click should select')
  assert(!hit!.mask[10 * image.width + 10], 'background corner must stay unselected')
  assert(!hit!.mask[70 * image.width + 10], 'left background must stay unselected')
  assert(!!hit!.mask[70 * image.width + 80], 'bar interior must stay selected')
}

function testPegboardBackgroundIsRejected(): void {
  const image = createImageData(200, 160)
  fillRect(image, 0, 0, 200, 160, 196, 168, 120)
  for (let y = 8; y < 152; y += 16) {
    for (let x = 8; x < 192; x += 16) {
      fillRect(image, x, y, 4, 4, 48, 48, 52)
    }
  }
  fillRect(image, 70, 50, 60, 44, 36, 36, 40)

  const objectHit = magicWandSelection(image, 100, 72, { colorTolerance: 32 })
  const boardHit = magicWandSelection(image, 20, 20, { colorTolerance: 32 })
  assert(!!objectHit, 'dark object on pegboard should select')
  assert(countMask(objectHit!.mask) < 60 * 44 * 1.15, 'object fill should not swallow the board')
  assert(!boardHit, 'clicking the pegboard should be rejected as background')
}

function testSeparateObjectStaysSeparate(): void {
  const image = createImageData(240, 100)
  fillRect(image, 0, 0, 240, 100, 180, 90, 200)
  fillRect(image, 16, 30, 80, 40, 40, 42, 48)
  fillRect(image, 144, 30, 80, 40, 40, 42, 48)

  const left = magicWandSelection(image, 40, 50, { colorTolerance: 32 })
  assert(!!left, 'left bar should select')
  assert(!!left!.mask[50 * image.width + 40], 'left bar interior selected')
  assert(!left!.mask[50 * image.width + 180], 'right bar must stay unselected')
}

const tests = [
  ['nearby clicks on noisy bar stay stable', testNearbyClicksOnNoisyBarStayStable],
  ['specular click does not collapse fill', testSpecularClickDoesNotCollapseFill],
  ['object does not leak into background', testObjectDoesNotLeakIntoBackground],
  ['pegboard background is rejected', testPegboardBackgroundIsRejected],
  ['separate object stays separate', testSeparateObjectStaysSeparate],
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
console.log(`\n${tests.length - failed}/${tests.length} magic-wand tests passed`)
