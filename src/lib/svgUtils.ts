import ImageTracer from 'imagetracerjs'
import type { OutputMode } from '../types.ts'
import { LASER_INK_MAX_LUMINANCE } from './laserCleanup.ts'
import {
  imageDataToDataUrl,
  loadImageDataFromDataUrl,
  trimImageData,
} from './trimUtils.ts'

const TRACE_PADDING = 2
const LASER_TRACE_LONG_SIDE = 2048

function hasVectorPaths(svg: string): boolean {
  return /<path[\s>]/i.test(svg)
}

function parseRgb(fill: string): [number, number, number] | null {
  const match = fill.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function isLightFill(fill: string): boolean {
  const rgb = parseRgb(fill)
  if (!rgb) return false
  return rgb[0] >= 235 && rgb[1] >= 235 && rgb[2] >= 235
}

function isLaserInkFill(fill: string): boolean {
  const rgb = parseRgb(fill)
  if (!rgb) return /#000/i.test(fill)
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] < LASER_INK_MAX_LUMINANCE
}

function rewritePathAttributes(pathTag: string, mode: OutputMode): string {
  const fillMatch = pathTag.match(/fill="([^"]+)"/i)
  if (fillMatch && isLightFill(fillMatch[1])) return ''
  if (mode === 'laser' && fillMatch && !isLaserInkFill(fillMatch[1])) return ''

  if (mode !== 'laser') return pathTag

  let rewritten = pathTag.replace(/\sstroke="[^"]*"/i, '').replace(/\sstroke-width="[^"]*"/i, '')
  if (!/fill-rule=/i.test(rewritten)) {
    rewritten = rewritten.replace(/<path\b/i, '<path fill-rule="evenodd"')
  }
  if (!/\sstroke=/i.test(rewritten)) {
    rewritten = rewritten.replace(/<path\b/i, '<path stroke="none"')
  }
  return rewritten
}

export function sanitizeSvg(
  svg: string,
  pathWidth: number,
  pathHeight: number,
  displayWidth: number,
  displayHeight: number,
  mode: OutputMode,
): string {
  const withoutBackgroundPaths = svg.replace(
    /<path\b[^>]*\/>|<path\b[^>]*>[\s\S]*?<\/path>/gi,
    (pathTag) => rewritePathAttributes(pathTag, mode),
  )

  return withoutBackgroundPaths.replace(
    /<svg\b[^>]*>/i,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${displayWidth}" height="${displayHeight}" viewBox="0 0 ${pathWidth} ${pathHeight}">`,
  )
}

function createEmbeddedSvg(dataUrl: string, width: number, height: number): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `  <image href="${dataUrl}" width="${width}" height="${height}" />`,
    '</svg>',
  ].join('\n')
}

/** Map laser pixels to opaque black ink on white paper. Do not treat every
 * opaque pixel as ink — that paints the paper black and traces a solid plate. */
export function flattenLaserTracePaper(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const ink =
      data[i + 3] >= 30 &&
      0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < LASER_INK_MAX_LUMINANCE
    const value = ink ? 0 : 255
    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
    data[i + 3] = 255
  }
}

export function laserTraceScale(width: number, height: number): number {
  const longSide = Math.max(width, height)
  if (longSide <= 0) return 1
  return Math.max(1, Math.min(6, Math.round(LASER_TRACE_LONG_SIDE / longSide)))
}

function upsampleNearest(source: ImageData, scale: number): ImageData {
  if (scale <= 1) return source
  const width = source.width * scale
  const height = source.height * scale
  const prepared = new ImageData(width, height)
  const { data } = source
  const out = prepared.data

  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(source.height - 1, Math.floor(y / scale))
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(source.width - 1, Math.floor(x / scale))
      const src = (sy * source.width + sx) * 4
      const dest = (y * width + x) * 4
      out[dest] = data[src]
      out[dest + 1] = data[src + 1]
      out[dest + 2] = data[src + 2]
      out[dest + 3] = data[src + 3]
    }
  }

  return prepared
}

function prepareTraceImageData(
  source: ImageData,
  mode: OutputMode,
): ImageData {
  const { width, height, data } = source
  const prepared = new ImageData(width, height)
  const out = prepared.data

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]

    if (alpha < 30) {
      out[i] = 255
      out[i + 1] = 255
      out[i + 2] = 255
      out[i + 3] = 255
      continue
    }

    if (mode === 'laser') {
      const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      const ink = luminance < LASER_INK_MAX_LUMINANCE ? 0 : 255
      out[i] = ink
      out[i + 1] = ink
      out[i + 2] = ink
      out[i + 3] = 255
    } else {
      out[i] = data[i]
      out[i + 1] = data[i + 1]
      out[i + 2] = data[i + 2]
      out[i + 3] = 255
    }
  }

  if (mode === 'laser') {
    flattenLaserTracePaper(prepared.data)
  }

  return prepared
}

function runTrace(imageData: ImageData, mode: OutputMode): string {
  const options =
    mode === 'laser'
      ? {
          ltres: 1,
          qtres: 1,
          pathomit: 8,
          colorsampling: 0,
          numberofcolors: 2,
          colorquantcycles: 1,
          mincolorratio: 0,
          pal: [
            { r: 0, g: 0, b: 0, a: 255 },
            { r: 255, g: 255, b: 255, a: 255 },
          ],
          strokewidth: 0,
          linefilter: false,
          rightangleenhance: false,
          layering: 0,
          scale: 1,
          roundcoords: 2,
          viewbox: true,
          desc: false,
        }
      : {
          ltres: 1,
          qtres: 1,
          pathomit: 8,
          colorsampling: 2,
          numberofcolors: 16,
          mincolorratio: 0.02,
          strokewidth: 0,
          linefilter: false,
          scale: 1,
          roundcoords: 1,
          viewbox: true,
          desc: false,
        }

  return ImageTracer.imagedataToSVG(imageData, options)
}

export async function pngToSvg(dataUrl: string, mode: OutputMode): Promise<string> {
  const source = await loadImageDataFromDataUrl(dataUrl)
  const trimmed = trimImageData(source, TRACE_PADDING)
  const prepared = prepareTraceImageData(trimmed, mode)
  const displayWidth = prepared.width
  const displayHeight = prepared.height
  const traceSource =
    mode === 'laser'
      ? upsampleNearest(prepared, laserTraceScale(prepared.width, prepared.height))
      : prepared
  const { width, height } = traceSource

  const tracedSvg = sanitizeSvg(
    runTrace(traceSource, mode),
    width,
    height,
    displayWidth,
    displayHeight,
    mode,
  )
  if (hasVectorPaths(tracedSvg)) {
    return tracedSvg
  }

  const posterizedSvg = sanitizeSvg(
    ImageTracer.imagedataToSVG(traceSource, 'posterized2'),
    width,
    height,
    displayWidth,
    displayHeight,
    mode,
  )
  if (hasVectorPaths(posterizedSvg)) {
    return posterizedSvg
  }

  const trimmedDataUrl = imageDataToDataUrl(trimmed)
  return createEmbeddedSvg(trimmedDataUrl, displayWidth, displayHeight)
}
