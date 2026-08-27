import ImageTracer from 'imagetracerjs'
import type { OutputMode } from '../types'
import { cleanupLaserInk } from './laserCleanup'
import {
  imageDataToDataUrl,
  loadImageDataFromDataUrl,
  trimImageData,
} from './trimUtils'

const TRACE_PADDING = 2
const LASER_TRACE_SCALE = 2

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
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] < 140
}

function sanitizeSvg(
  svg: string,
  pathWidth: number,
  pathHeight: number,
  displayWidth: number,
  displayHeight: number,
  mode: OutputMode,
): string {
  const withoutBackgroundPaths = svg.replace(
    /<path\b[^>]*\/>|<path\b[^>]*>[\s\S]*?<\/path>/gi,
    (pathTag) => {
      const fillMatch = pathTag.match(/fill="([^"]+)"/i)
      if (!fillMatch) return pathTag
      if (isLightFill(fillMatch[1])) return ''
      if (mode === 'laser' && !isLaserInkFill(fillMatch[1])) return ''
      return pathTag
    },
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
      const ink = luminance < 140 ? 0 : 255
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
    cleanupLaserInk(prepared)
    const cleaned = prepared.data
    for (let i = 0; i < cleaned.length; i += 4) {
      if (cleaned[i + 3] < 30) {
        cleaned[i] = 255
        cleaned[i + 1] = 255
        cleaned[i + 2] = 255
        cleaned[i + 3] = 255
      } else {
        cleaned[i] = 0
        cleaned[i + 1] = 0
        cleaned[i + 2] = 0
        cleaned[i + 3] = 255
      }
    }
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
          mincolorratio: 0,
          pal: [
            { r: 0, g: 0, b: 0, a: 255 },
            { r: 255, g: 255, b: 255, a: 255 },
          ],
          strokewidth: 0,
          linefilter: true,
          rightangleenhance: false,
          scale: 1,
          roundcoords: 0,
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
    mode === 'laser' ? upsampleNearest(prepared, LASER_TRACE_SCALE) : prepared
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
