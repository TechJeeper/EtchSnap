import { CHROMA_KEY } from './chromaKey.ts'
import {
  countStencilRegions,
  createPhotoStencil,
  createSilhouetteReference,
  fitDesignToMask,
  looksLikeStencilEdit,
  outputMaskForDesign,
  prepareEditTemplate,
  stencilRespectScore,
} from './fitToMask.ts'
import type { PixelImage } from './isolateArtwork.ts'

function createImage(width: number, height: number, r = 0, g = 0, b = 0, a = 0): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = a
  }
  return { data, width, height }
}

function fillRect(
  image: PixelImage,
  x: number,
  y: number,
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a = 255,
): void {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      const index = (py * image.width + px) * 4
      image.data[index] = r
      image.data[index + 1] = g
      image.data[index + 2] = b
      image.data[index + 3] = a
    }
  }
}

function sample(image: PixelImage, x: number, y: number) {
  const index = (y * image.width + x) * 4
  return {
    r: image.data[index],
    g: image.data[index + 1],
    b: image.data[index + 2],
    a: image.data[index + 3],
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function testOutputMaskKeepsGeneratedResolution(): void {
  const mask = createImage(40, 20)
  fillRect(mask, 4, 4, 32, 12, 10, 10, 10, 255)
  fillRect(mask, 16, 8, 8, 4, 0, 0, 0, 0)

  const design = createImage(80, 40, 0, 0, 0, 255)
  const outputMask = outputMaskForDesign(mask, design, 80)
  assert(outputMask.width === 80 && outputMask.height === 40, 'mask should match the generated long side')
  assert(sample(outputMask, 2, 2).a === 0, 'outside the selection must stay empty after upscale')
  assert(sample(outputMask, 40, 20).a === 0, 'holes must stay empty after upscale')
  assert(sample(outputMask, 20, 16).a > 200, 'selected interior must stay opaque after upscale')

  const fitted = fitDesignToMask(design, outputMask, 'nearest')
  assert(fitted.width === 80 && fitted.height === 40, 'clipped design must keep generated resolution')
  assert(sample(fitted, 20, 16).a > 200, 'artwork pixels must survive instead of being downsampled')
}

function testSameFramingClipKeepsHolesEmpty(): void {
  const mask = createImage(120, 40)
  fillRect(mask, 10, 8, 100, 24, 10, 10, 10, 255)
  fillRect(mask, 55, 16, 10, 8, 0, 0, 0, 0)

  const design = createImage(120, 40, 0, 0, 0, 255)
  const fitted = fitDesignToMask(design, mask)

  assert(fitted.width === 120 && fitted.height === 40, 'fitted design must match the selected crop size')
  assert(sample(fitted, 2, 2).a === 0, 'pixels outside the selection must be transparent')
  assert(sample(fitted, 60, 20).a === 0, 'holes inside the selection must stay transparent')
  assert(sample(fitted, 20, 20).a > 200, 'pixels inside the selection must keep the design')
}

function testEditTemplateIsColoringBookStencil(): void {
  const mask = createImage(200, 60)
  fillRect(mask, 20, 10, 160, 40, 40, 90, 160, 255)
  fillRect(mask, 90, 20, 20, 20, 0, 0, 0, 0)

  const template = prepareEditTemplate(mask, 200)
  assert(template.width === 200 && template.height === 60, 'native-size stencil should keep the crop framing')
  const inside = sample(template, 40, 30)
  const hole = sample(template, 100, 30)
  const outside = sample(template, 2, 2)
  assert(inside.r > 240 && inside.g > 240, 'selected area should be a blank coloring-book fill')
  assert(hole.r === CHROMA_KEY.r && hole.b === CHROMA_KEY.b, 'cutouts must stay magenta')
  assert(outside.r === CHROMA_KEY.r && outside.b === CHROMA_KEY.b, 'outside must stay magenta')
}

function testPhotoStencilKeepsInteriorColor(): void {
  const mask = createImage(40, 20)
  fillRect(mask, 8, 4, 24, 12, 200, 180, 40, 255)
  const stencil = createPhotoStencil(mask)
  const edge = sample(stencil, 8, 8)
  const inner = sample(stencil, 20, 10)
  assert(edge.r === 200 && edge.g === 180, 'silhouette edge should keep the source color')
  assert(inner.r === 200 && inner.g === 180, 'interior photo pixels should stay intact')
}

function testRespectScoreDetectsEditedStencil(): void {
  const mask = createImage(80, 40)
  fillRect(mask, 8, 8, 64, 24, 255, 255, 255, 255)
  const template = createSilhouetteReference(mask)
  const edited = {
    data: new Uint8ClampedArray(template.data),
    width: template.width,
    height: template.height,
  }
  fillRect(edited, 8, 8, 64, 24, 20, 20, 20, 255)
  const score = stencilRespectScore(edited, template)
  assert(score.respect > 0.9, 'magenta around an edited stencil should be preserved')
  assert(score.fill > 0.9, 'blank stencil pixels should be filled with artwork')
}

function testRespectScoreDetectsFullScene(): void {
  const mask = createImage(80, 40)
  fillRect(mask, 8, 8, 64, 24, 255, 255, 255, 255)
  const template = createSilhouetteReference(mask)
  const scene = createImage(80, 40, 30, 80, 20, 255)
  const score = stencilRespectScore(scene, template)
  assert(score.respect < 0.2, 'a full-bleed scene should fail stencil respect')
}

function testLooksLikeStencilEditAcceptsInPlacePaint(): void {
  const mask = createImage(80, 40)
  fillRect(mask, 8, 8, 64, 24, 180, 120, 40, 255)
  const template = createPhotoStencil(mask)
  const edited = {
    data: new Uint8ClampedArray(template.data),
    width: template.width,
    height: template.height,
  }
  fillRect(edited, 10, 10, 60, 20, 20, 20, 20, 255)
  assert(looksLikeStencilEdit(edited, template), 'in-place paint on the silhouette should count as a stencil edit')
}

function testLooksLikeStencilEditRejectsFullScene(): void {
  const mask = createImage(80, 40)
  fillRect(mask, 8, 8, 64, 24, 180, 120, 40, 255)
  const template = createPhotoStencil(mask)
  const scene = createImage(80, 40, 30, 80, 20, 255)
  assert(!looksLikeStencilEdit(scene, template), 'a full-bleed scene should not count as a stencil edit')
}

function testCountStencilRegionsSplitsLetters(): void {
  const mask = createImage(80, 20)
  fillRect(mask, 2, 4, 16, 12, 255, 255, 255, 255)
  fillRect(mask, 32, 4, 16, 12, 255, 255, 255, 255)
  fillRect(mask, 62, 4, 16, 12, 255, 255, 255, 255)
  const template = createSilhouetteReference(mask)
  assert(countStencilRegions(template) === 3, 'disconnected letters should count as separate stencil regions')
}

const tests = [
  ['output mask keeps generated resolution', testOutputMaskKeepsGeneratedResolution],
  ['same framing clip keeps holes empty', testSameFramingClipKeepsHolesEmpty],
  ['edit template is coloring-book stencil', testEditTemplateIsColoringBookStencil],
  ['photo stencil keeps interior color', testPhotoStencilKeepsInteriorColor],
  ['respect score detects edited stencil', testRespectScoreDetectsEditedStencil],
  ['respect score detects full scene', testRespectScoreDetectsFullScene],
  ['looks like stencil edit accepts in-place paint', testLooksLikeStencilEditAcceptsInPlacePaint],
  ['looks like stencil edit rejects full scene', testLooksLikeStencilEditRejectsFullScene],
  ['count stencil regions splits letters', testCountStencilRegionsSplitsLetters],
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
console.log(`\n${tests.length - failed}/${tests.length} fit-to-mask tests passed`)
