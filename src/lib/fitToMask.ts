import { CHROMA_KEY } from './chromaKey.ts'
import type { PixelImage } from './isolateArtwork.ts'

const MASK_ALPHA = 16
const BLANK_FILL = 248
const MAGENTA_TEMPLATE_TOLERANCE = 40
const MAGENTA_GENERATED_TOLERANCE = 55

function sampleBilinear(image: PixelImage, x: number, y: number): [number, number, number, number] {
  const maxX = image.width - 1
  const maxY = image.height - 1
  const x0 = Math.max(0, Math.min(maxX, Math.floor(x)))
  const y0 = Math.max(0, Math.min(maxY, Math.floor(y)))
  const x1 = Math.min(maxX, x0 + 1)
  const y1 = Math.min(maxY, y0 + 1)
  const tx = x - x0
  const ty = y - y0

  const i00 = (y0 * image.width + x0) * 4
  const i10 = (y0 * image.width + x1) * 4
  const i01 = (y1 * image.width + x0) * 4
  const i11 = (y1 * image.width + x1) * 4
  const { data } = image

  const mix = (a: number, b: number, t: number) => a + (b - a) * t
  const channel = (offset: number) =>
    mix(
      mix(data[i00 + offset], data[i10 + offset], tx),
      mix(data[i01 + offset], data[i11 + offset], tx),
      ty,
    )

  return [channel(0), channel(1), channel(2), channel(3)]
}

function sampleNearest(image: PixelImage, x: number, y: number): [number, number, number, number] {
  const sx = Math.max(0, Math.min(image.width - 1, Math.round(x)))
  const sy = Math.max(0, Math.min(image.height - 1, Math.round(y)))
  const index = (sy * image.width + sx) * 4
  return [image.data[index], image.data[index + 1], image.data[index + 2], image.data[index + 3]]
}

function isMagenta(r: number, g: number, b: number, tolerance: number): boolean {
  return (
    Math.abs(r - CHROMA_KEY.r) < tolerance &&
    g < 90 &&
    Math.abs(b - CHROMA_KEY.b) < tolerance
  )
}

export function createSilhouetteReference(mask: PixelImage): PixelImage {
  const data = new Uint8ClampedArray(mask.data.length)

  for (let i = 0; i < mask.data.length; i += 4) {
    if (mask.data[i + 3] > MASK_ALPHA) {
      data[i] = BLANK_FILL
      data[i + 1] = BLANK_FILL
      data[i + 2] = BLANK_FILL
      data[i + 3] = 255
    } else {
      data[i] = CHROMA_KEY.r
      data[i + 1] = CHROMA_KEY.g
      data[i + 2] = CHROMA_KEY.b
      data[i + 3] = 255
    }
  }

  return { data, width: mask.width, height: mask.height }
}

export function createPhotoStencil(source: PixelImage): PixelImage {
  const data = new Uint8ClampedArray(source.data.length)

  for (let i = 0; i < source.data.length; i += 4) {
    if (source.data[i + 3] > MASK_ALPHA) {
      data[i] = source.data[i]
      data[i + 1] = source.data[i + 1]
      data[i + 2] = source.data[i + 2]
      data[i + 3] = 255
    } else {
      data[i] = CHROMA_KEY.r
      data[i + 1] = CHROMA_KEY.g
      data[i + 2] = CHROMA_KEY.b
      data[i + 3] = 255
    }
  }

  return { data, width: source.width, height: source.height }
}

export function scalePixelImage(image: PixelImage, scale: number): PixelImage {
  if (Math.abs(scale - 1) < 0.001) {
    return {
      data: new Uint8ClampedArray(image.data),
      width: image.width,
      height: image.height,
    }
  }

  return resizePixelImage(
    image,
    Math.max(1, Math.round(image.width * scale)),
    Math.max(1, Math.round(image.height * scale)),
  )
}

export function resizePixelImage(
  image: PixelImage,
  width: number,
  height: number,
): PixelImage {
  if (image.width === width && image.height === height) {
    return {
      data: new Uint8ClampedArray(image.data),
      width,
      height,
    }
  }

  const data = new Uint8ClampedArray(width * height * 4)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = sampleBilinear(
        image,
        ((x + 0.5) / width) * image.width - 0.5,
        ((y + 0.5) / height) * image.height - 0.5,
      )
      const index = (y * width + x) * 4
      data[index] = r
      data[index + 1] = g
      data[index + 2] = b
      data[index + 3] = a
    }
  }

  return { data, width, height }
}

export function prepareStencilTemplate(
  mask: PixelImage,
  minLongSide = 1024,
): PixelImage {
  const longSide = Math.max(mask.width, mask.height)
  const scale = longSide < minLongSide ? minLongSide / longSide : 1
  return createSilhouetteReference(scalePixelImage(mask, scale))
}

export function prepareEditTemplate(
  source: PixelImage,
  minLongSide = 1024,
): PixelImage {
  const longSide = Math.max(source.width, source.height)
  const scale = longSide < minLongSide ? minLongSide / longSide : 1
  // Blank coloring-book stencil: photo pixels invite the model to overlay a
  // texture and crop it. A light fill on magenta makes it draw inside the shape.
  return createSilhouetteReference(scalePixelImage(source, scale))
}

export function fitDesignToMask(
  design: PixelImage,
  mask: PixelImage,
  sampling: 'bilinear' | 'nearest' = 'bilinear',
): PixelImage {
  const out = {
    data: new Uint8ClampedArray(mask.width * mask.height * 4),
    width: mask.width,
    height: mask.height,
  }

  const sample = sampling === 'nearest' ? sampleNearest : sampleBilinear

  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      const index = (y * mask.width + x) * 4
      const maskAlpha = mask.data[index + 3]
      if (maskAlpha <= MASK_ALPHA) continue

      const [r, g, b, a] = sample(
        design,
        ((x + 0.5) / mask.width) * design.width - 0.5,
        ((y + 0.5) / mask.height) * design.height - 0.5,
      )
      if (isMagenta(r, g, b, MAGENTA_GENERATED_TOLERANCE)) continue
      const alpha = Math.min(a, maskAlpha)
      if (alpha <= MASK_ALPHA) continue

      out.data[index] = r
      out.data[index + 1] = g
      out.data[index + 2] = b
      out.data[index + 3] = alpha
    }
  }

  return out
}

export function aspectRatioMismatch(a: PixelImage, b: PixelImage): number {
  const arA = a.width / Math.max(a.height, 1)
  const arB = b.width / Math.max(b.height, 1)
  return Math.abs(Math.log(arA / arB))
}

export function stencilRespectScore(
  generated: PixelImage,
  template: PixelImage,
): {
  respect: number
  fill: number
  change: number
  aspectMismatch: number
} {
  const aligned =
    generated.width === template.width && generated.height === template.height
      ? generated
      : resizePixelImage(generated, template.width, template.height)

  let magentaPixels = 0
  let magentaKept = 0
  let blankPixels = 0
  let blankFilled = 0
  let changedPixels = 0

  for (let i = 0; i < template.data.length; i += 4) {
    const templateMagenta = isMagenta(
      template.data[i],
      template.data[i + 1],
      template.data[i + 2],
      MAGENTA_TEMPLATE_TOLERANCE,
    )
    const generatedMagenta = isMagenta(
      aligned.data[i],
      aligned.data[i + 1],
      aligned.data[i + 2],
      MAGENTA_GENERATED_TOLERANCE,
    )

    if (templateMagenta) {
      magentaPixels += 1
      if (generatedMagenta) magentaKept += 1
      continue
    }

    blankPixels += 1
    if (!generatedMagenta) blankFilled += 1

    const distance = Math.hypot(
      aligned.data[i] - template.data[i],
      aligned.data[i + 1] - template.data[i + 1],
      aligned.data[i + 2] - template.data[i + 2],
    )
    if (distance > 28) changedPixels += 1
  }

  return {
    respect: magentaPixels === 0 ? 0 : magentaKept / magentaPixels,
    fill: blankPixels === 0 ? 0 : blankFilled / blankPixels,
    change: blankPixels === 0 ? 0 : changedPixels / blankPixels,
    aspectMismatch: aspectRatioMismatch(generated, template),
  }
}

export function looksLikeStencilEdit(
  generated: PixelImage,
  template: PixelImage,
): boolean {
  const score = stencilRespectScore(generated, template)
  return (
    score.aspectMismatch < 0.18 &&
    score.respect >= 0.52 &&
    score.fill >= 0.35 &&
    score.change >= 0.22
  )
}

function isStencilPixel(template: PixelImage, index: number): boolean {
  return !isMagenta(
    template.data[index],
    template.data[index + 1],
    template.data[index + 2],
    MAGENTA_TEMPLATE_TOLERANCE,
  )
}

export function countStencilRegions(template: PixelImage, minPixels = 40): number {
  const { width, height } = template
  const seen = new Uint8Array(width * height)
  let regions = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x
      if (seen[start] || !isStencilPixel(template, start * 4)) continue

      let area = 0
      const stack = [start]
      seen[start] = 1

      while (stack.length > 0) {
        const i = stack.pop()
        if (i === undefined) break
        area += 1
        const cx = i % width
        const cy = Math.floor(i / width)
        const neighbors = [i - 1, i + 1, i - width, i + width]
        const valid = [
          cx > 0,
          cx + 1 < width,
          cy > 0,
          cy + 1 < height,
        ]
        for (let n = 0; n < 4; n += 1) {
          if (!valid[n]) continue
          const next = neighbors[n]
          if (seen[next] || !isStencilPixel(template, next * 4)) continue
          seen[next] = 1
          stack.push(next)
        }
      }

      if (area >= minPixels) regions += 1
    }
  }

  return regions
}
