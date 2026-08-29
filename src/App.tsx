import { useCallback, useEffect, useMemo, useState } from 'react'
import { ImageSelector } from './components/ImageSelector'
import { ModelSelect } from './components/ModelSelect'
import { ProviderSelect } from './components/ProviderSelect'
import { generateDesign } from './lib/generateDesign'
import { enhanceDescription } from './lib/enhanceDescription'
import {
  fetchGeminiModels,
  getDefaultGeminiImageModel,
  getDefaultGeminiTextModel,
  type ModelOption,
} from './lib/geminiModels'
import {
  fetchOpenAiModels,
  getDefaultOpenAiImageModel,
  getDefaultOpenAiTextModel,
} from './lib/openaiModels'
import {
  cropSelectionToBase64,
  downloadDataUrl,
  downloadText,
  getSelectionBounds,
  imageToDataUrl,
  isValidSelection,
  loadImageFromFile,
} from './lib/imageUtils'
import { buildOverlayRegions, type OverlayRegion } from './lib/selectionLayout'
import { pngToSvg } from './lib/svgUtils'
import { getComplexityLabel } from './lib/prompt'
import {
  trackDownload,
  trackEnhance,
  trackGenerate,
  trackOutputMode,
  trackProvider,
} from './lib/analytics'
import type { ImageProvider, OutputMode, Selection } from './types'
import { PROVIDER_OPTIONS } from './types'
import './App.css'

const GEMINI_KEY_STORAGE = 'etchsnap-gemini-api-key'
const OPENAI_KEY_STORAGE = 'etchsnap-openai-api-key'
const PROVIDER_STORAGE = 'etchsnap-image-provider'
const GEMINI_TEXT_MODEL_STORAGE = 'etchsnap-gemini-text-model'
const GEMINI_IMAGE_MODEL_STORAGE = 'etchsnap-gemini-image-model'
const OPENAI_TEXT_MODEL_STORAGE = 'etchsnap-openai-text-model'
const OPENAI_IMAGE_MODEL_STORAGE = 'etchsnap-openai-image-model'
const COMPLEXITY_STORAGE = 'etchsnap-design-complexity'

function App() {
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 })
  const [provider, setProvider] = useState<ImageProvider>(
    () => (localStorage.getItem(PROVIDER_STORAGE) as ImageProvider) || 'gemini',
  )
  const [geminiApiKey, setGeminiApiKey] = useState(
    () => localStorage.getItem(GEMINI_KEY_STORAGE) ?? '',
  )
  const [openaiApiKey, setOpenaiApiKey] = useState(
    () => localStorage.getItem(OPENAI_KEY_STORAGE) ?? '',
  )
  const [geminiTextModel, setGeminiTextModel] = useState(
    () => localStorage.getItem(GEMINI_TEXT_MODEL_STORAGE) ?? '',
  )
  const [geminiImageModel, setGeminiImageModel] = useState(
    () => localStorage.getItem(GEMINI_IMAGE_MODEL_STORAGE) ?? '',
  )
  const [openaiTextModel, setOpenaiTextModel] = useState(
    () => localStorage.getItem(OPENAI_TEXT_MODEL_STORAGE) ?? '',
  )
  const [openaiImageModel, setOpenaiImageModel] = useState(
    () => localStorage.getItem(OPENAI_IMAGE_MODEL_STORAGE) ?? '',
  )
  const [textModels, setTextModels] = useState<ModelOption[]>([])
  const [imageModels, setImageModels] = useState<ModelOption[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [description, setDescription] = useState('')
  const [complexity, setComplexity] = useState(() => {
    const raw = localStorage.getItem(COMPLEXITY_STORAGE)
    if (raw == null || raw.trim() === '') return 50
    const stored = Number(raw)
    return Number.isFinite(stored) ? Math.min(100, Math.max(0, stored)) : 50
  })
  const [mode, setMode] = useState<OutputMode>('uv')
  const [resultDataUrl, setResultDataUrl] = useState<string | null>(null)
  const [overlaySourceUrl, setOverlaySourceUrl] = useState<string | null>(null)
  const [overlayRegions, setOverlayRegions] = useState<OverlayRegion[]>([])
  const [showObject, setShowObject] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [isExportingSvg, setIsExportingSvg] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const providerConfig = useMemo(
    () => PROVIDER_OPTIONS.find((option) => option.id === provider) ?? PROVIDER_OPTIONS[0],
    [provider],
  )

  const apiKey = provider === 'openai' ? openaiApiKey : geminiApiKey
  const textModel = provider === 'openai' ? openaiTextModel : geminiTextModel
  const imageModel = provider === 'openai' ? openaiImageModel : geminiImageModel

  useEffect(() => {
    const key = apiKey.trim()
    if (key.length < 8) {
      setTextModels([])
      setImageModels([])
      setModelsError(null)
      setIsLoadingModels(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      setIsLoadingModels(true)
      setModelsError(null)

      try {
        if (provider === 'gemini') {
          const models = await fetchGeminiModels(key)
          if (cancelled) return

          setTextModels(models.textModels)
          setImageModels(models.imageModels)

          setGeminiTextModel((current) => {
            const next =
              current && models.textModels.some((model) => model.id === current)
                ? current
                : getDefaultGeminiTextModel(models.textModels)
            localStorage.setItem(GEMINI_TEXT_MODEL_STORAGE, next)
            return next
          })

          setGeminiImageModel((current) => {
            const next =
              current && models.imageModels.some((model) => model.id === current)
                ? current
                : getDefaultGeminiImageModel(models.imageModels)
            localStorage.setItem(GEMINI_IMAGE_MODEL_STORAGE, next)
            return next
          })
        } else {
          const models = await fetchOpenAiModels(key)
          if (cancelled) return

          setTextModels(models.textModels)
          setImageModels(models.imageModels)

          setOpenaiTextModel((current) => {
            const next =
              current && models.textModels.some((model) => model.id === current)
                ? current
                : getDefaultOpenAiTextModel(models.textModels)
            localStorage.setItem(OPENAI_TEXT_MODEL_STORAGE, next)
            return next
          })

          setOpenaiImageModel((current) => {
            const next =
              current && models.imageModels.some((model) => model.id === current)
                ? current
                : getDefaultOpenAiImageModel(models.imageModels)
            localStorage.setItem(OPENAI_IMAGE_MODEL_STORAGE, next)
            return next
          })
        }
      } catch (err) {
        if (!cancelled) {
          setTextModels([])
          setImageModels([])
          setModelsError(
            err instanceof Error ? err.message : 'Could not load models for this API key.',
          )
        }
      } finally {
        if (!cancelled) setIsLoadingModels(false)
      }
    }, 700)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [provider, apiKey])

  const handleTextModelChange = (value: string) => {
    if (provider === 'openai') {
      setOpenaiTextModel(value)
      localStorage.setItem(OPENAI_TEXT_MODEL_STORAGE, value)
      return
    }

    setGeminiTextModel(value)
    localStorage.setItem(GEMINI_TEXT_MODEL_STORAGE, value)
  }

  const handleImageModelChange = (value: string) => {
    if (provider === 'openai') {
      setOpenaiImageModel(value)
      localStorage.setItem(OPENAI_IMAGE_MODEL_STORAGE, value)
      return
    }

    setGeminiImageModel(value)
    localStorage.setItem(GEMINI_IMAGE_MODEL_STORAGE, value)
  }

  const handleDisplaySizeChange = useCallback(
    (size: { width: number; height: number }) => setDisplaySize(size),
    [],
  )

  const canGenerate =
    apiKey.trim().length > 0 &&
    textModel.trim().length > 0 &&
    imageModel.trim().length > 0 &&
    sourceImage &&
    isValidSelection(selection) &&
    displaySize.width > 0 &&
    description.trim().length > 0 &&
    !isGenerating &&
    !isEnhancing &&
    !isLoadingModels

  const canEnhance =
    apiKey.trim().length > 0 &&
    textModel.trim().length > 0 &&
    description.trim().length > 0 &&
    !isEnhancing &&
    !isGenerating &&
    !isLoadingModels

  const handleProviderChange = (value: ImageProvider) => {
    setProvider(value)
    localStorage.setItem(PROVIDER_STORAGE, value)
    setError(null)
    trackProvider(value)
  }

  const handleApiKeyChange = (value: string) => {
    if (provider === 'openai') {
      setOpenaiApiKey(value)
      localStorage.setItem(OPENAI_KEY_STORAGE, value)
      return
    }

    setGeminiApiKey(value)
    localStorage.setItem(GEMINI_KEY_STORAGE, value)
  }

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const image = await loadImageFromFile(file)
      setSourceImage(image)
      setFileName(file.name)
      setSelection(null)
      setResultDataUrl(null)
      setOverlaySourceUrl(null)
      setOverlayRegions([])
      setShowObject(false)
      setError(null)
    } catch {
      setError('Could not load that image. Try a JPG or PNG file.')
    }
  }

  const handleEnhanceDescription = async () => {
    if (!canEnhance) return

    setIsEnhancing(true)
    setError(null)

    try {
      const enhanced = await enhanceDescription({
        provider,
        apiKey: apiKey.trim(),
        textModel: textModel.trim(),
        description: description.trim(),
        mode,
        complexity,
      })
      setDescription(enhanced)
      trackEnhance(provider, mode)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not enhance description. Please try again.'
      setError(message)
    } finally {
      setIsEnhancing(false)
    }
  }

  const handleGenerate = async () => {
    if (!canGenerate || !sourceImage || !selection) return

    setIsGenerating(true)
    setError(null)
    setResultDataUrl(null)
    setOverlaySourceUrl(null)
    setOverlayRegions([])
    setShowObject(false)

    try {
      const { base64, mimeType } = cropSelectionToBase64(
        sourceImage,
        selection,
        displaySize.width,
        displaySize.height,
      )

      setOverlayRegions(buildOverlayRegions(selection, displaySize.width, displaySize.height))
      setOverlaySourceUrl(imageToDataUrl(sourceImage))

      const dataUrl = await generateDesign({
        provider,
        apiKey: apiKey.trim(),
        imageModel: imageModel.trim(),
        croppedImageBase64: base64,
        mimeType,
        description: description.trim(),
        mode,
        complexity,
        partCount: 1,
      })

      setResultDataUrl(dataUrl)
      trackGenerate(provider, mode)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Generation failed. Please try again.'
      setError(message)
    } finally {
      setIsGenerating(false)
    }
  }

  const baseFileName = fileName?.replace(/\.[^.]+$/, '') ?? 'etchsnap-design'

  const handleDownloadPng = () => {
    if (!resultDataUrl) return
    downloadDataUrl(resultDataUrl, `${baseFileName}-${mode}.png`)
    trackDownload('png', mode)
  }

  const handleDownloadSvg = async () => {
    if (!resultDataUrl) return

    setIsExportingSvg(true)
    setError(null)

    try {
      const svg = await pngToSvg(resultDataUrl, mode)
      downloadText(svg, `${baseFileName}-${mode}.svg`, 'image/svg+xml')
      trackDownload('svg', mode)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'SVG export failed. Please try again.'
      setError(message)
    } finally {
      setIsExportingSvg(false)
    }
  }

  const selectionBounds = selection ? getSelectionBounds(selection) : null
  const selectionPointCount = selection?.regions.reduce(
    (total, region) => total + region.points.length,
    0,
  )

  return (
    <div className="app">
      <header className="header">
        <div>
          <p className="eyebrow">UV print & laser engraving</p>
          <h1>EtchSnap</h1>
          <p className="subtitle">
            Upload a top-down photo, click around the edges to outline your surface,
            describe your design, and download a transparent PNG or vector SVG ready
            for production.
          </p>
        </div>
      </header>

      <main className="layout">
        <section className="panel">
          <div className="panel-header">
            <h2>1. Source photo & area</h2>
            <label className="upload-button">
              {sourceImage ? 'Replace photo' : 'Upload photo'}
              <input type="file" accept="image/*" hidden onChange={handleUpload} />
            </label>
          </div>

          <div className="image-stage">
            <ImageSelector
              image={sourceImage}
              selection={selection}
              onSelectionChange={setSelection}
              onDisplaySizeChange={handleDisplaySizeChange}
            />
          </div>

          {selectionBounds && (
            <p className="selection-meta">
              {selection?.regions.length === 1 ? '1 region' : `${selection?.regions.length ?? 0} regions`}{' '}
              · {selectionPointCount ?? 0} points · approx.{' '}
              {Math.round(selectionBounds.width)} × {Math.round(selectionBounds.height)} px
            </p>
          )}
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>2. Design settings</h2>
          </div>

          <label className="field">
            <span>Image provider</span>
            <ProviderSelect value={provider} onChange={handleProviderChange} />
          </label>

          <label className="field">
            <span>{providerConfig.label} API key</span>
            <div className="api-key-row">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(event) => handleApiKeyChange(event.target.value)}
                placeholder={providerConfig.keyPlaceholder}
                autoComplete="off"
              />
              <button
                type="button"
                className="ghost-button"
                onClick={() => setShowApiKey((value) => !value)}
              >
                {showApiKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <small>
              Kept in your browser only (localStorage). EtchSnap has no backend and never
              stores your key on a server. Get a key from{' '}
              <a href={providerConfig.keyHelpUrl} target="_blank" rel="noreferrer">
                {providerConfig.keyHelpLabel}
              </a>
              .
            </small>
          </label>

          {apiKey.trim().length > 0 && (
            <>
              <label className="field">
                <span>Text model (AI Enhance)</span>
                <ModelSelect
                  value={textModel}
                  options={textModels}
                  onChange={handleTextModelChange}
                  placeholder={isLoadingModels ? 'Loading models…' : 'Select a text model'}
                  disabled={isLoadingModels || textModels.length === 0}
                />
              </label>

              <label className="field">
                <span>Image model (design generation)</span>
                <ModelSelect
                  value={imageModel}
                  options={imageModels}
                  onChange={handleImageModelChange}
                  placeholder={isLoadingModels ? 'Loading models…' : 'Select an image model'}
                  disabled={isLoadingModels || imageModels.length === 0}
                />
              </label>

              {isLoadingModels && (
                <p className="selection-meta">Loading available models for your API key…</p>
              )}
              {modelsError && <p className="error">{modelsError}</p>}
            </>
          )}

          <div className="field">
            <div className="field-label-row">
              <span>Design description</span>
              <button
                type="button"
                className="ghost-button enhance-button"
                disabled={!canEnhance}
                onClick={handleEnhanceDescription}
              >
                {isEnhancing ? 'Enhancing…' : 'AI Enhance'}
              </button>
            </div>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={5}
              placeholder="Example: Art deco floral border with the initials C.M. in the center, elegant and symmetrical."
            />
          </div>

          <label className="field">
            <div className="field-label-row">
              <span>Design complexity</span>
              <span className="complexity-value">{getComplexityLabel(complexity)}</span>
            </div>
            <div className="complexity-slider">
              <span>Simple</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={complexity}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  setComplexity(next)
                  localStorage.setItem(COMPLEXITY_STORAGE, String(next))
                }}
                aria-label="Design complexity"
              />
              <span>Complex</span>
            </div>
            {mode === 'laser' && (
              <p className="field-hint">
                Higher adds more continuous engraving lines, not finer speckle.
              </p>
            )}
          </label>

          <fieldset className="mode-toggle">
            <legend>Output mode</legend>
            <label className={`mode-option ${mode === 'uv' ? 'active' : ''}`}>
              <input
                type="radio"
                name="mode"
                value="uv"
                checked={mode === 'uv'}
                onChange={() => {
                  setMode('uv')
                  trackOutputMode('uv')
                }}
              />
              <div>
                <strong>Full color</strong>
                <span>For UV printing</span>
              </div>
            </label>
            <label className={`mode-option ${mode === 'laser' ? 'active' : ''}`}>
              <input
                type="radio"
                name="mode"
                value="laser"
                checked={mode === 'laser'}
                onChange={() => {
                  setMode('laser')
                  trackOutputMode('laser')
                }}
              />
              <div>
                <strong>Black & white</strong>
                <span>For laser engraving</span>
              </div>
            </label>
          </fieldset>

          <button
            type="button"
            className="primary-button"
            disabled={!canGenerate}
            onClick={handleGenerate}
          >
            {isGenerating ? 'Generating design…' : 'Generate transparent design'}
          </button>

          {error && <p className="error">{error}</p>}
        </section>

        <section className="panel result-panel">
          <div className="panel-header">
            <h2>3. Download</h2>
            {resultDataUrl && (
              <div className="download-actions">
                <button type="button" className="ghost-button" onClick={handleDownloadPng}>
                  Download PNG
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={isExportingSvg}
                  onClick={handleDownloadSvg}
                >
                  {isExportingSvg ? 'Creating SVG…' : 'Download SVG'}
                </button>
              </div>
            )}
          </div>

          {resultDataUrl && (
            <div className="result-preview-bar">
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={showObject}
                  disabled={!overlaySourceUrl || overlayRegions.length === 0}
                  onChange={() => setShowObject((value) => !value)}
                />
                <span className="switch" aria-hidden="true" />
                Show original photo behind design
              </label>
              <span className="result-preview-note">
                Preview only — PNG and SVG downloads stay design-only.
              </span>
            </div>
          )}

          <div className="result-frame">
            {resultDataUrl ? (
              <div
                className={`result-composite${showObject && overlaySourceUrl && overlayRegions.length > 0 ? ' has-source' : ''}`}
              >
                {showObject && overlaySourceUrl && overlayRegions.length > 0 && (
                  <img
                    className="result-source-layer"
                    src={overlaySourceUrl}
                    alt="Original photo"
                  />
                )}
                {showObject && overlayRegions.length > 0
                  ? overlayRegions.map((region, index) => (
                      <img
                        key={`${region.x}-${region.y}-${index}`}
                        className="result-design-layer"
                        src={resultDataUrl}
                        alt=""
                        style={{
                          left: `${region.x * 100}%`,
                          top: `${region.y * 100}%`,
                          width: `${region.width * 100}%`,
                          height: `${region.height * 100}%`,
                          clipPath: region.clipPath,
                        }}
                      />
                    ))
                  : (
                      <img
                        className="result-design-layer"
                        src={resultDataUrl}
                        alt="Generated design preview"
                      />
                    )}
              </div>
            ) : (
              <div className="result-placeholder">
                <p>Your transparent design preview will appear here.</p>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
