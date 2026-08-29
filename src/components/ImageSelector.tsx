import { useCallback, useEffect, useRef, useState } from 'react'
import type { Point, Selection, SelectionPath, SelectionTool } from '../types'
import { isValidRegion } from '../lib/imageUtils'
import { getMagicWandEdgeThreshold, magicWandSelection, scaleMagicWandHit } from '../lib/magicWand'
import { mergeSelectionRegions } from '../lib/selectionMerge'

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

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function drawPath(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  closed: boolean,
  hoverPoint?: Point | null,
  nearStart = false,
): void {
  if (points.length === 0) return

  if (points.length >= 2) {
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i].x, points[i].y)
    }
    if (closed) ctx.closePath()

    if (closed) {
      ctx.fillStyle = 'rgba(99, 102, 241, 0.18)'
      ctx.fill()
    }

    ctx.strokeStyle = '#818cf8'
    ctx.lineWidth = 2
    ctx.setLineDash(closed ? [] : [6, 4])
    ctx.stroke()
    ctx.setLineDash([])
  }

  if (!closed && points.length > 0 && hoverPoint) {
    ctx.beginPath()
    ctx.moveTo(points[points.length - 1].x, points[points.length - 1].y)
    ctx.lineTo(hoverPoint.x, hoverPoint.y)
    ctx.strokeStyle = 'rgba(129, 140, 248, 0.55)'
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
      ctx.fillStyle = isStart ? '#c4b5fd' : '#818cf8'
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
  const shiftHeldRef = useRef(false)
  const [baseDisplaySize, setBaseDisplaySize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [tool, setTool] = useState<SelectionTool>('polygon')
  const [draftPoints, setDraftPoints] = useState<Point[]>([])
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null)
  const [wandTolerance, setWandTolerance] = useState(32)
  const [wandError, setWandError] = useState<string | null>(null)

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
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') shiftHeldRef.current = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
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

    selection?.regions.forEach((region) => {
      if (region.points.length > 0) {
        drawPath(ctx, region.points, region.closed)
      }
    })

    if (isDrawing && draftPoints.length > 0) {
      drawPath(ctx, draftPoints, false, hoverPoint, nearStart)
    }
  }, [image, baseDisplaySize, selection, draftPoints, hoverPoint, isDrawing, nearStart])

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

  const finalizeShape = (points: Point[], append: boolean) => {
    const closedPath: SelectionPath = { points, closed: true }
    setDraftPoints([])
    setHoverPoint(null)
    applyRegion(closedPath, append)
  }

  const handleWandClick = (point: Point, append: boolean) => {
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
    const append = event.shiftKey || shiftHeldRef.current

    if (tool === 'wand') {
      handleWandClick(point, append)
      return
    }

    if (
      draftPoints.length >= MIN_POINTS &&
      distance(point, draftPoints[0]) <= CLOSE_RADIUS
    ) {
      finalizeShape(draftPoints, append)
      return
    }

    if (regionCount > 0 && draftPoints.length === 0 && !append) {
      onSelectionChange(null)
    }

    setDraftPoints((points) => [...points, point])
  }

  const handleFinish = () => {
    if (draftPoints.length >= MIN_POINTS) {
      finalizeShape(draftPoints, shiftHeldRef.current)
    }
  }

  const handleUndo = () => {
    setDraftPoints((points) => points.slice(0, -1))
  }

  const handleClear = () => {
    setDraftPoints([])
    setHoverPoint(null)
    setWandError(null)
    onSelectionChange(null)
  }

  const handleToolChange = (nextTool: SelectionTool) => {
    setTool(nextTool)
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
            {tool === 'wand'
              ? 'Click a surface to select it. Click nearby to add more of the same object. Hold Shift to add a separate region. Zoom in for precise edges; raise sensitivity if the fill stops too early.'
              : isDrawing
                ? nearStart
                  ? ' Click the first point to close the shape. Hold Shift while closing to add another region.'
                  : ' Click Finish shape or snap to the first point to close. Hold Shift to keep existing regions.'
                : ' Click along the edges to place points. Hold Shift when starting a new shape to add another region.'}
          </p>
          {wandError && tool === 'wand' && <p className="error">{wandError}</p>}
        </>
      )}
    </div>
  )
}
