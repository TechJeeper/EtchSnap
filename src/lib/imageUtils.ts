import type { OutputMode, Point, Selection, SelectionPath } from '../types'
import { removeFrameBorder, stripOuterEdgePixels } from './borderRemoval'
import { isChromaKeyColor, isMagentaFamily } from './chromaKey'
import { isolateArtwork } from './isolateArtwork'
import { fitDesignToMask, outputMaskForDesign } from './fitToMask'
import { cleanupLaserInk, LASER_INK_MAX_LUMINANCE } from './laserCleanup'
import { imageDataToDataUrl, trimImageData } from './trimUtils'

export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }
    img.src = url
  })
}

export function imageToDataUrl(
  image: HTMLImageElement,
  mimeType = 'image/jpeg',
  quality = 0.92,
): string {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create canvas context')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, 0, 0)
  return canvas.toDataURL(mimeType, quality)
}

export function getPathBounds(points: Point[]) {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

const MIN_SELECTION_POINTS = 3
const MIN_SELECTION_BOUNDS = 24

export function isValidRegion(path: SelectionPath): boolean {
  if (path.points.length < MIN_SELECTION_POINTS || !path.closed) return false
  const bounds = getPathBounds(path.points)
  return bounds.width >= MIN_SELECTION_BOUNDS && bounds.height >= MIN_SELECTION_BOUNDS
}

export function isValidSelection(selection: Selection | null): boolean {
  return !!selection && selection.regions.length > 0 && selection.regions.every(isValidRegion)
}

export function getSelectionBounds(selection: Selection) {
  return getPathBounds(selection.regions.flatMap((region) => region.points))
}

export function cropPathToBase64(
  image: HTMLImageElement,
  path: SelectionPath,
  displayWidth: number,
  displayHeight: number,
): { base64: string; mimeType: string } {
  return cropSelectionToBase64(
    image,
    { regions: [path] },
    displayWidth,
    displayHeight,
  )
}

export function cropSelectionToBase64(
  image: HTMLImageElement,
  selection: Selection,
  displayWidth: number,
  displayHeight: number,
): { base64: string; mimeType: string } {
  const scaleX = image.naturalWidth / displayWidth
  const scaleY = image.naturalHeight / displayHeight

  const scaledRegions = selection.regions.map((region) =>
    region.points.map((point) => ({
      x: point.x * scaleX,
      y: point.y * scaleY,
    })),
  )

  const bounds = getPathBounds(scaledRegions.flat())
  const sw = Math.max(1, Math.ceil(bounds.width))
  const sh = Math.max(1, Math.ceil(bounds.height))

  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create canvas context')

  ctx.beginPath()
  for (const scaledPoints of scaledRegions) {
    scaledPoints.forEach((point, index) => {
      const x = point.x - bounds.x
      const y = point.y - bounds.y
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.closePath()
  }
  ctx.clip()

  ctx.drawImage(image, bounds.x, bounds.y, sw, sh, 0, 0, sw, sh)

  const dataUrl = canvas.toDataURL('image/png')
  const [, base64] = dataUrl.split(',')
  return { base64, mimeType: 'image/png' }
}

export function base64ToDataUrl(base64: string, mimeType = 'image/png'): string {
  return `data:${mimeType};base64,${base64}`
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  link.click()
}

export function downloadText(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export async function postProcessDesign(
  base64: string,
  mode: OutputMode,
  sourceBase64?: string,
): Promise<string> {
  const img = await loadImageFromBase64(base64)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create canvas context')

  ctx.drawImage(img, 0, 0)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

  let sourceImageData: ImageData | null = null
  if (sourceBase64) {
    try {
      const sourceImage = await loadImageFromBase64(sourceBase64)
      const sourceCanvas = document.createElement('canvas')
      sourceCanvas.width = sourceImage.naturalWidth
      sourceCanvas.height = sourceImage.naturalHeight
      const sourceCtx = sourceCanvas.getContext('2d')
      if (sourceCtx) {
        sourceCtx.drawImage(sourceImage, 0, 0)
        sourceImageData = sourceCtx.getImageData(
          0,
          0,
          sourceCanvas.width,
          sourceCanvas.height,
        )
      }
    } catch {
      sourceImageData = null
    }
  }

  isolateArtwork(imageData, sourceImageData)

  if (!sourceImageData) {
    for (let pass = 0; pass < 3; pass += 1) {
      if (!removeFrameBorder(imageData)) break
    }
    stripOuterEdgePixels(imageData, 2)
  }

  const { data } = imageData

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const a = data[i + 3]

    if (a < 16) {
      data[i + 3] = 0
      continue
    }

    const luminance = 0.299 * r + 0.587 * g + 0.114 * b

    if (luminance > 245 && a < 220) {
      data[i + 3] = 0
      continue
    }

    if (mode === 'laser') {
      if (isMagentaFamily(r, g, b) || isChromaKeyColor(r, g, b)) {
        data[i + 3] = 0
        continue
      }
      const ink = luminance < LASER_INK_MAX_LUMINANCE ? 0 : 255
      data[i] = ink
      data[i + 1] = ink
      data[i + 2] = ink
      data[i + 3] = ink === 255 ? 0 : 255
    }
  }

  if (mode === 'laser') {
    cleanupLaserInk(imageData)
  }

  ctx.putImageData(imageData, 0, 0)

  if (sourceImageData) {
    const outputMask = outputMaskForDesign(sourceImageData, imageData)
    const fitted = fitDesignToMask(
      imageData,
      outputMask,
      mode === 'laser' ? 'nearest' : 'bilinear',
    )
    canvas.width = fitted.width
    canvas.height = fitted.height
    const fittedCtx = canvas.getContext('2d')
    if (!fittedCtx) throw new Error('Could not create canvas context')
    const fittedData = fittedCtx.createImageData(fitted.width, fitted.height)
    fittedData.data.set(fitted.data)
    if (mode === 'laser') {
      const pixels = fittedData.data
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < 16) {
          pixels[i + 3] = 0
          continue
        }
        const luminance = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]
        const ink = luminance < LASER_INK_MAX_LUMINANCE ? 0 : 255
        pixels[i] = ink
        pixels[i + 1] = ink
        pixels[i + 2] = ink
        pixels[i + 3] = ink === 255 ? 0 : 255
      }
    }
    fittedCtx.putImageData(fittedData, 0, 0)
    return imageDataToDataUrl(fittedData)
  }

  const trimmed = trimImageData(
    ctx.getImageData(0, 0, canvas.width, canvas.height),
    4,
  )
  return imageDataToDataUrl(trimmed)
}

function loadImageFromBase64(base64: string): Promise<HTMLImageElement> {
  return loadImageFromDataUrl(base64ToDataUrl(base64))
}

export function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to decode image'))
    img.src = dataUrl
  })
}
