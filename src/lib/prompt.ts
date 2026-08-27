import type { OutputMode } from '../types'
import { CHROMA_KEY } from './chromaKey.ts'

export function getComplexityLabel(complexity: number): string {
  if (complexity <= 20) return 'Simple'
  if (complexity <= 40) return 'Light'
  if (complexity <= 60) return 'Balanced'
  if (complexity <= 80) return 'Detailed'
  return 'Complex'
}

export function buildComplexityInstructions(complexity: number): string {
  if (complexity <= 20) {
    return `Keep the artwork SIMPLE: a few complete bold shapes that fill this silhouette.`
  }

  if (complexity <= 40) {
    return `Keep the artwork LIGHT: clean complete motifs that fill this silhouette.`
  }

  if (complexity <= 60) {
    return `Keep the artwork BALANCED: a complete composition drawn for this silhouette, not a cropped texture.`
  }

  if (complexity <= 80) {
    return `Keep the artwork DETAILED, but every motif must be complete and drawn to this silhouette. Detail comes from complete small objects, never from a cropped pattern.`
  }

  return `Keep the artwork COMPLEX, but composed for this silhouette. Use many complete small objects. No cropped fragments or repeating texture fills.`
}

function modeInstructions(mode: OutputMode): string {
  return mode === 'uv'
    ? `Use full vibrant color suitable for UV printing. Clean edges. Still draw complete objects, not a tiled texture.`
    : `Draw SOLID FILLED black (#000000) shapes that fill the silhouette. No outlines-only drawings, no fine linework, no hatching, stipple, honeycomb, or tiny isolated specks — those become unusable laser SVGs.`
}

function partLine(partCount: number): string {
  return partCount > 1
    ? `Compose ONE complete design for a single silhouette. Do not draw multiple copies.`
    : ''
}

function regionLine(regionCount: number): string {
  if (regionCount <= 1) {
    return `This stencil is ONE continuous silhouette. Pose ONE complete subject so it fills the entire light area. Scale it up to use all of the available space. Nothing important may be sliced by the outline.`
  }

  return `This stencil has ${regionCount} SEPARATE regions, split by magenta. Treat each region as its own tiny sticker / coloring-book page. Draw one complete object in each region and fill all space inside that region. Do not run one texture, pattern, or scene across multiple regions.`
}

function themeLine(description: string): string {
  return `Theme to illustrate as complete objects (one object per region), never as a repeating texture, cropped photo, or pattern fill:
${description}

If that theme mentions gears, honeycomb, mesh, plates, or machinery, build each region as ONE complete gadget, vehicle, or character MADE FROM those parts, scaled to fill the region. Do not tile those parts like wallpaper.`
}

export function buildPrompt(
  description: string,
  mode: OutputMode,
  complexity: number,
  _aspectRatio?: string,
  partCount = 1,
  hasReferenceImage = false,
  strictInpaint = false,
  regionCount = 0,
): string {
  if (!hasReferenceImage) {
    return `Create standalone printable artwork: a decal / UV print / engraving graphic.

This is NOT a product mockup. The output will be printed or engraved onto a real object later.

Design request: ${description}

${buildComplexityInstructions(complexity)}
${partLine(partCount)}

Output requirements:
- Return ONLY the decorative design artwork itself
- Put the artwork on a perfectly uniform solid background of exactly ${CHROMA_KEY.hex}
- Fill empty areas, holes, and gaps with that same solid ${CHROMA_KEY.hex}
- Do NOT depict a physical object, mockup, table, or photograph
- Fill all space on the canvas
- ${modeInstructions(mode)}`
  }

  const strictLine = strictInpaint
    ? `CRITICAL RETRY: Previous results either ignored the stencil or filled it with a cropped texture. That is wrong.
Edit the attached PNG in place. Magenta stays ${CHROMA_KEY.hex}. Draw complete objects inside each light region and fill all space — never overlay a pattern and crop it.`
    : `EDIT THE ATTACHED IMAGE IN PLACE. Update the input image. Do not generate a new rectangular picture. Do not change the input aspect ratio.`

  return `${strictLine}

Using the provided coloring-book stencil, paint this design:
${themeLine(description)}

How to read the PNG:
- Light gray pixels = the die-cut silhouette. This is the only place you may draw.
- Magenta ${CHROMA_KEY.hex} is outside the part. Keep every magenta pixel exactly magenta.
- Holes in the silhouette (counters in letters, screw holes) stay magenta.

${regionLine(regionCount)}

How to compose — this is NOT a mask over a larger picture:
- Invent artwork whose silhouette IS this shape. Like a custom inlay or die-cut sticker.
- Fill all space: the artwork must occupy the entire light-gray silhouette. Do not leave large empty gaps, unused arms of letters, or a tiny stamp floating in the middle.
- Scale and arrange complete objects so they use the full width and height of each region.
- GOOD: one complete character or object per region, fully visible, like a robot standing inside a letter and filling that letter.
- BAD: filling the letters with a repeating gear/honeycomb/metal texture that gets sliced by the edges.
- Every head, wing, wheel, or foot must stay inside the light-gray silhouette. If something would be sliced, rearrange or add supporting objects so the region is still full.
- Do NOT place a larger illustration behind the stencil and cookie-cut it.

${buildComplexityInstructions(complexity)}
${partLine(partCount)}

Output:
- Return the same image, same width and height
- Artwork only in the light silhouette, filling all of that space
- Magenta stays ${CHROMA_KEY.hex} (RGB ${CHROMA_KEY.r}, ${CHROMA_KEY.g}, ${CHROMA_KEY.b})
- No mockup, product photo, table, or rectangular frame
- ${modeInstructions(mode)}`
}
