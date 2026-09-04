import { useCallback, useEffect, useRef, useState } from 'react'
import type { Point, Selection, SelectionPath, SelectionTool } from '../types'
import { isValidRegion } from '../lib/imageUtils'
import { getMagicWandEdgeThreshold, magicWandSelection, scaleMagicWandHit } from '../lib/magicWand'
import { mergeSelectionRegions } from '../lib/selectionMerge'
import { subtractSelectionRegions } from '../lib/selectionSubtract'

type EditMode = 'add' | 'remove'

interface ImageSelectorProps {
  image: HTMLImageElement | null
  selection: Selection | null
  onSelectionChange: (selection: Selection | null) => void
  onDisplaySizeChange?: (size: { width: number; height: number }) => void
}

const MIN_POINTS = 3
const CLOSE_RADIUS = 14
const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const ZOOM_STEP = 0.25
const MIN_MAGIC_WAND_MERGE_GAP = 12
// Small tolerance fills often leave a few pixels between adjacent wand picks, so
// keep a modest minimum bridge width even before the ratio-based gap grows.
const MAGIC_WAND_MERGE_GAP_RATIO = 0.6

const MASK_RED = { r: 230, g: 36, b: 36, a: 140 }
const MASK_INDIGO = { r: 99, g: 102, b: 241, a: 46 }
const MASK_FILL = `rgba(${MASK_RED.r}, ${MASK_RED.g}, ${MASK_RED.b}, 0.55)`
const OUTLINE_FILL = 'rgba(99, 102, 241, 0.18)'
const REMOVE_FILL = 'rgba(248, 113, 113, 0.18)'

interface PathStyle {
  fillStyle: string | null
  strokeStyle: string
  previewStroke: string
  pointFill: string
  startFill: string
}

const ADD_PATH_STYLE: PathStyle = {
  fillStyle: OUTLINE_FILL,
  strokeStyle: '#818cf8',
  previewStroke: 'rgba(129, 140, 248, 0.55)',
  pointFill: '#818cf8',
  startFill: '#c4b5fd',
}

const REMOVE_PATH_STYLE: PathStyle = {
  fillStyle: REMOVE_FILL,
  strokeStyle: '#f87171',
  previewStroke: 'rgba(248, 113, 113, 0.55)',
  pointFill: '#f87171',
  startFill: '#fca5a5',
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function stampRegionMask(
  pixels: Uint8ClampedArray,
  region: SelectionPath,
  width: number,
  height: number,
  color: { r: number; g: number; b: number; a: number },
): boolean {
  const { mask, maskWidth, maskHeight } = region
  if (!mask || !maskWidth || !maskHeight) return false

  let painted = false
  if (maskWidth === width && maskHeight === height) {
    for (let index = 0; index < mask.length; index += 1) {
      if (!mask[index]) continue
      const offset = index * 4
      pixels[offset] = color.r
      pixels[offset + 1] = color.g
      pixels[offset + 2] = color.b
      pixels[offset + 3] = color.a
      painted = true
    }
    return painted
  }

  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(maskHeight - 1, Math.round((y * maskHeight) / height))
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(maskWidth - 1, Math.round((x * maskWidth) / width))
      if (!mask[sourceY * maskWidth + sourceX]) continue
      const offset = (y * width + x) * 4
      pixels[offset] = color.r
      pixels[offset + 1] = color.g
      pixels[offset + 2] = color.b
      pixels[offset + 3] = color.a
      painted = true
    }
  }

  return painted
}

function drawSelectionMask(
  ctx: CanvasRenderingContext2D,
  overlay: HTMLCanvasElement,
  regions: SelectionPath[],
  width: number,
  height: number,
  color: { r: number; g: number; b: number; a: number },
): Set<SelectionPath> {
  const pixels = new Uint8ClampedArray(width * height * 4)
  const painted = new Set<SelectionPath>()

  for (const region of regions) {
    if (stampRegionMask(pixels, region, width, height, color)) {
      painted.add(region)
    }
  }

  if (painted.size === 0) return painted

  overlay.width = width
  overlay.height = height
  const overlayCtx = overlay.getContext('2d')
  if (!overlayCtx) return painted
  overlayCtx.putImageData(new ImageData(pixels, width, height), 0, 0)
  ctx.drawImage(overlay, 0, 0)
  return painted
}

function drawPath(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  closed: boolean,
  hoverPoint?: Point | null,
  nearStart = false,
  style: PathStyle = ADD_PATH_STYLE,
): void {
  if (points.length === 0) return

  if (points.length >= 2) {
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i].x, points[i].y)
    }
    if (closed) ctx.closePath()

    if (closed && style.fillStyle) {
      ctx.fillStyle = style.fillStyle
      ctx.fill()
    }

    ctx.strokeStyle = style.strokeStyle
    ctx.lineWidth = 2
    ctx.setLineDash(closed ? [] : [6, 4])
    ctx.stroke()
    ctx.setLineDash([])
  }

  if (!closed && points.length > 0 && hoverPoint) {
    ctx.beginPath()
    ctx.moveTo(points[points.length - 1].x, points[points.length - 1].y)
    ctx.lineTo(hoverPoint.x, hoverPoint.y)
    ctx.strokeStyle = style.previewStroke
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 4])
    ctx.stroke()
    ctx.setLineDash([])
  }

  if (!closed) {
    points.forEach((point, index) => {
      const isStart = index === 0
      const radius = isStart && nearStart ? 8 : isStart ? 6 : 4
      ctx.beginPath()
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = isStart ? style.startFill : style.pointFill
      ctx.fill()
      ctx.strokeStyle = '#eef2ff'
      ctx.lineWidth = 1.5
      ctx.stroke()
    })
  }
}

export function ImageSelector({
  image,
  selection,
  onSelectionChange,
  onDisplaySizeChange,
}: ImageSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sourceImageDataRef = useRef<ImageData | null>(null)
  const maskOverlayRef = useRef<HTMLCanvasElement | null>(null)
  const shiftHeldRef = useRef(false)
  const altHeldRef = useRef(false)
  const [baseDisplaySize, setBaseDisplaySize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [tool, setTool] = useState<SelectionTool>('polygon')
  const [editMode, setEditMode] = useState<EditMode>('add')
  const [draftPoints, setDraftPoints] = useState<Point[]>([])
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null)
  const [wandTolerance, setWandTolerance] = useState(32)
  const [wandError, setWandError] = useState<string | null>(null)
  const [showMask, setShowMask] = useState(false)

  const isDrawing = tool === 'polygon' && draftPoints.length > 0
  const regionCount = selection?.regions.length ?? 0
  const zoomFrameWidth = Math.round(baseDisplaySize.width * zoom)
  const zoomFrameHeight = Math.round(baseDisplaySize.height * zoom)

  const nearStart =
    isDrawing &&
    draftPoints.length >= MIN_POINTS &&
    hoverPoint !== null &&
    distance(hoverPoint, draftPoints[0]) <= CLOSE_RADIUS

  const updateDisplaySize = useCallback(() => {
    if (!image || !viewportRef.current) return

    const maxWidth = viewportRef.current.clientWidth
    if (maxWidth === 0) return

    const next = {
      width: maxWidth,
      height: Math.round((maxWidth * image.naturalHeight) / image.naturalWidth),
    }
    setBaseDisplaySize(next)
    onDisplaySizeChange?.(next)
  }, [image, onDisplaySizeChange])

  useEffect(() => {
    setZoom(1)
    setEditMode('add')
    setDraftPoints([])
    setHoverPoint(null)
    setWandError(null)
  }, [image])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!image || !viewport) return

    const observer = new ResizeObserver(() => {
      updateDisplaySize()
    })
    observer.observe(viewport)
    updateDisplaySize()

    return () => observer.disconnect()
  }, [image, updateDisplaySize])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') shiftHeldRef.current = true
      if (event.key === 'Alt') altHeldRef.current = true
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') shiftHeldRef.current = false
      if (event.key === 'Alt') altHeldRef.current = false
    }
    const onBlur = () => {
      shiftHeldRef.current = false
      altHeldRef.current = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  useEffect(() => {
    if (!image) {
      sourceImageDataRef.current = null
      return
    }

    const source = document.createElement('canvas')
    source.width = image.naturalWidth
    source.height = image.naturalHeight
    const sourceCtx = source.getContext('2d', { willReadFrequently: true })
    if (!sourceCtx) return
    sourceCtx.drawImage(image, 0, 0)
    sourceImageDataRef.current = sourceCtx.getImageData(
      0,
      0,
      image.naturalWidth,
      image.naturalHeight,
    )
  }, [image])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !image || baseDisplaySize.width === 0) return

    canvas.width = baseDisplaySize.width
    canvas.height = baseDisplaySize.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, baseDisplaySize.width, baseDisplaySize.height)

    const paintedMasks =
      selection?.regions.length
        ? drawSelectionMask(
            ctx,
            maskOverlayRef.current ?? (maskOverlayRef.current = document.createElement('canvas')),
            selection.regions,
            canvas.width,
            canvas.height,
            showMask ? MASK_RED : MASK_INDIGO,
          )
        : new Set<SelectionPath>()

    selection?.regions.forEach((region) => {
      if (region.points.length === 0) return
      const fillStyle = paintedMasks.has(region)
        ? null
        : showMask
          ? MASK_FILL
          : OUTLINE_FILL
      drawPath(ctx, region.points, region.closed, undefined, false, {
        ...ADD_PATH_STYLE,
        fillStyle,
      })
    })

    if (isDrawing && draftPoints.length > 0) {
      drawPath(
        ctx,
        draftPoints,
        false,
        hoverPoint,
        nearStart,
        editMode === 'remove' ? REMOVE_PATH_STYLE : ADD_PATH_STYLE,
      )
    }
  }, [image, baseDisplaySize, selection, draftPoints, hoverPoint, isDrawing, nearStart, showMask, editMode])

  const clampPoint = (x: number, y: number): Point => ({
    x: Math.max(0, Math.min(baseDisplaySize.width, x)),
    y: Math.max(0, Math.min(baseDisplaySize.height, y)),
  })

  const getCanvasPoint = (
    event: React.MouseEvent<HTMLCanvasElement>,
  ): Point => {
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return { x: 0, y: 0 }
    }

    return clampPoint(
      ((event.clientX - rect.left) / rect.width) * baseDisplaySize.width,
      ((event.clientY - rect.top) / rect.height) * baseDisplaySize.height,
    )
  }

  const adjustZoom = (delta: number) => {
    setZoom((current) => {
      const next = Math.round((current + delta) * 100) / 100
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
    })
  }

  const handleZoomSlider = (value: number) => {
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value / 100)))
  }

  const applyRegion = (closedPath: SelectionPath, append: boolean) => {
    if (!isValidRegion(closedPath)) {
      if (!append) onSelectionChange(null)
      return false
    }

    if (append && selection?.regions.length) {
      onSelectionChange({
        regions: mergeSelectionRegions(selection.regions, closedPath, {
          mergeNearbyGap:
            tool === 'wand'
              ? Math.max(MIN_MAGIC_WAND_MERGE_GAP, wandTolerance * MAGIC_WAND_MERGE_GAP_RATIO)
              : 0,
        }),
      })
    } else {
      onSelectionChange({ regions: [closedPath] })
    }

    return true
  }

  const applyCut = (closedPath: SelectionPath) => {
    if (!selection?.regions.length) {
      setWandError('Select an area first, then remove from it.')
      return false
    }

    const { regions, removedPixelCount } = subtractSelectionRegions(
      selection.regions,
      closedPath,
      baseDisplaySize.width,
      baseDisplaySize.height,
    )

    if (removedPixelCount === 0) {
      setWandError('That area is not inside the current selection.')
      return false
    }

    if (regions.length === 0) {
      onSelectionChange(null)
      setEditMode('add')
      setWandError(null)
      return true
    }

    onSelectionChange({ regions })
    setWandError(null)
    return true
  }

  const finalizeShape = (points: Point[], append: boolean, subtract: boolean) => {
    const closedPath: SelectionPath = { points, closed: true }
    setDraftPoints([])
    setHoverPoint(null)
    if (subtract) {
      applyCut(closedPath)
      return
    }
    applyRegion(closedPath, append)
  }

  const handleWandClick = (point: Point, append: boolean, subtract: boolean) => {
    const imageData = sourceImageDataRef.current
    if (!imageData || baseDisplaySize.width === 0 || baseDisplaySize.height === 0) {
      setWandError('Could not read the photo pixels. Try uploading again.')
      return
    }

    const seedX = (point.x / baseDisplaySize.width) * imageData.width
    const seedY = (point.y / baseDisplaySize.height) * imageData.height
    const nativeHit = magicWandSelection(imageData, seedX, seedY, {
      colorTolerance: wandTolerance,
      edgeThreshold: getMagicWandEdgeThreshold(wandTolerance),
    })

    if (!nativeHit) {
      setWandError(
        'Could not detect a bounded surface there. Click the object itself (not the pegboard/background), or adjust sensitivity.',
      )
      return
    }

    const hit = scaleMagicWandHit(nativeHit, baseDisplaySize.width, baseDisplaySize.height)
    const closedPath: SelectionPath = {
      points: hit.points,
      closed: true,
      mask: hit.mask,
      maskWidth: hit.width,
      maskHeight: hit.height,
    }

    if (subtract) {
      applyCut(closedPath)
      return
    }

    const mergeGap = Math.max(MIN_MAGIC_WAND_MERGE_GAP, wandTolerance * MAGIC_WAND_MERGE_GAP_RATIO)
    const shouldGrow =
      !append &&
      !!selection?.regions.length &&
      mergeSelectionRegions(selection.regions, closedPath, { mergeNearbyGap: mergeGap }).length <=
        selection.regions.length

    if (!applyRegion(closedPath, append || shouldGrow)) {
      setWandError('That area is too small. Click a larger surface or lower sensitivity.')
      return
    }

    setWandError(null)
  }

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!image) return

    const point = getCanvasPoint(event)
    const subtract = editMode === 'remove' || event.altKey || altHeldRef.current
    const append = !subtract && (event.shiftKey || shiftHeldRef.current)

    if (tool === 'wand') {
      handleWandClick(point, append, subtract)
      return
    }

    if (
      draftPoints.length >= MIN_POINTS &&
      distance(point, draftPoints[0]) <= CLOSE_RADIUS
    ) {
      finalizeShape(draftPoints, append, subtract)
      return
    }

    if (regionCount > 0 && draftPoints.length === 0 && !append && !subtract) {
      onSelectionChange(null)
    }

    setDraftPoints((points) => [...points, point])
  }

  const handleFinish = () => {
    if (draftPoints.length >= MIN_POINTS) {
      const subtract = editMode === 'remove' || altHeldRef.current
      finalizeShape(draftPoints, !subtract && shiftHeldRef.current, subtract)
    }
  }

  const handleUndo = () => {
    setDraftPoints((points) => points.slice(0, -1))
  }

  const handleClear = () => {
    setDraftPoints([])
    setHoverPoint(null)
    setWandError(null)
    setEditMode('add')
    onSelectionChange(null)
  }

  const handleToolChange = (nextTool: SelectionTool) => {
    setTool(nextTool)
    setDraftPoints([])
    setHoverPoint(null)
    setWandError(null)
  }

  const handleEditModeChange = (nextMode: EditMode) => {
    setEditMode(nextMode)
    setDraftPoints([])
    setHoverPoint(null)
    setWandError(null)
  }

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!image || !isDrawing) return
    setHoverPoint(getCanvasPoint(event))
  }

  const handleMouseLeave = () => {
    setHoverPoint(null)
  }

  return (
    <div className="image-selector" ref={containerRef}>
      {!image ? (
        <div className="image-placeholder">
          <p>Upload a top-down photo to begin</p>
          <span>Outline the surface manually or use the magic wand on visible edges</span>
        </div>
      ) : (
        <>
          <div className="selector-toolbar">
            <div className="selector-tool-groups">
              <div className="tool-toggle">
                <button
                  type="button"
                  className={`ghost-button tool-button${tool === 'polygon' ? ' active' : ''}`}
                  onClick={() => handleToolChange('polygon')}
                >
                  Outline
                </button>
                <button
                  type="button"
                  className={`ghost-button tool-button${tool === 'wand' ? ' active' : ''}`}
                  onClick={() => handleToolChange('wand')}
                >
                  Magic wand
                </button>
              </div>
              <div className="tool-toggle">
                <button
                  type="button"
                  className={`ghost-button tool-button${editMode === 'add' ? ' active' : ''}`}
                  onClick={() => handleEditModeChange('add')}
                >
                  Add
                </button>
                <button
                  type="button"
                  className={`ghost-button tool-button${editMode === 'remove' ? ' active active-remove' : ''}`}
                  onClick={() => handleEditModeChange('remove')}
                >
                  Remove
                </button>
              </div>
            </div>
            {tool === 'polygon' ? (
              <>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={!isDrawing}
                  onClick={handleUndo}
                >
                  Undo point
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={draftPoints.length < MIN_POINTS}
                  onClick={handleFinish}
                >
                  Finish shape
                </button>
              </>
            ) : (
              <label className="wand-sensitivity">
                <span>Sensitivity</span>
                <input
                  type="range"
                  min={8}
                  max={96}
                  value={wandTolerance}
                  onChange={(event) => setWandTolerance(Number(event.target.value))}
                />
                <span className="wand-sensitivity-value">{wandTolerance}</span>
              </label>
            )}
            <button type="button" className="ghost-button" onClick={handleClear}>
              Clear {regionCount > 1 ? 'all' : 'selection'}
            </button>
          </div>
          <div className="selector-toolbar selector-toolbar-secondary">
            <div className="zoom-controls">
              <span>Zoom</span>
              <button
                type="button"
                className="ghost-button zoom-button"
                aria-label="Zoom out"
                disabled={zoom <= MIN_ZOOM}
                onClick={() => adjustZoom(-ZOOM_STEP)}
              >
                −
              </button>
              <input
                type="range"
                min={MIN_ZOOM * 100}
                max={MAX_ZOOM * 100}
                step={5}
                value={Math.round(zoom * 100)}
                onChange={(event) => handleZoomSlider(Number(event.target.value))}
                aria-label="Zoom level"
              />
              <button
                type="button"
                className="ghost-button zoom-button"
                aria-label="Zoom in"
                disabled={zoom >= MAX_ZOOM}
                onClick={() => adjustZoom(ZOOM_STEP)}
              >
                +
              </button>
              <span className="zoom-value">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                className="ghost-button"
                disabled={zoom === 1}
                onClick={() => setZoom(1)}
              >
                Fit
              </button>
            </div>
            <label className="overlay-toggle selector-mask-toggle">
              <input
                type="checkbox"
                checked={showMask}
                onChange={() => setShowMask((value) => !value)}
              />
              <span className="switch" aria-hidden="true" />
              Show mask
            </label>
          </div>
          <div
            ref={viewportRef}
            className="canvas-viewport"
            style={{
              height: baseDisplaySize.height > 0 ? baseDisplaySize.height : undefined,
            }}
          >
            <div
              className="canvas-zoom-frame"
              style={{
                width: zoomFrameWidth,
                height: zoomFrameHeight,
              }}
            >
              <canvas
                ref={canvasRef}
                className={`selection-canvas${tool === 'wand' ? ' wand-cursor' : ''}`}
                width={baseDisplaySize.width}
                height={baseDisplaySize.height}
                style={{
                  width: baseDisplaySize.width,
                  height: baseDisplaySize.height,
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top left',
                }}
                onClick={handleCanvasClick}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
              />
            </div>
          </div>
          <p className="canvas-hint">
            {editMode === 'remove'
              ? tool === 'wand'
                ? 'Click inside the selection to subtract that surface. Lower sensitivity to target small hardware like screws. Hold Alt while adding to subtract without switching modes.'
                : isDrawing
                  ? 'Trace the area to remove, then finish the shape. The cutout stays punched through the selection.'
                  : 'Trace around the area to subtract, then finish the shape. Select an area first if nothing is selected yet.'
              : tool === 'wand'
                ? 'Click a surface to select it. Click nearby to add more of the same object. Hold Shift to add a separate region. Use Remove (or hold Alt) to punch out hardware. Zoom in for precise edges; raise sensitivity if the fill stops too early.'
                : isDrawing
                  ? nearStart
                    ? ' Click the first point to close the shape. Hold Shift while closing to add another region.'
                    : ' Click Finish shape or snap to the first point to close. Hold Shift to keep existing regions.'
                  : ' Click along the edges to place points. Hold Shift when starting a new shape to add another region. Use Remove to cut a hole.'}
          </p>
          {wandError && <p className="error">{wandError}</p>}
        </>
      )}
    </div>
  )
}
