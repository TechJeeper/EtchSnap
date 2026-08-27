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
    : `Draw SOLID FILLED black (#000000) shapes with smooth edges. Fill the silhouette. No fine hatching, stipple, or tiny isolated specks.`
}

function partLine(partCount: number): string {
  return partCount > 1
    ? `Compose ONE complete design for a single silhouette. Do not draw multiple copies.`
    : ''
}

function regionLine(regionCount: number): string {
  if (regionCount <= 1) {
    return `This stencil is ONE part. Paint all the way to the edges of the light gray — including notches, tapers, corners, and the long sides. The artwork's outer contour must match this silhouette. Do not leave a blank margin inside the part. Do not inset a smaller copy of the shape.`
  }

  return `This stencil has ${regionCount} SEPARATE regions, split by magenta. Treat each region as its own tiny sticker / coloring-book page. Draw one complete object in each region and fill all space inside that region. Do not run one texture, pattern, or scene across multiple regions.`
}

function themeLine(description: string, regionCount: number): string {
  if (regionCount <= 1) {
    return `Theme for this entire part. Fill every light-gray pixel:
${description}

Compose complete motifs along this silhouette so they reach the edges. If the theme includes gears or machinery, place whole gears that fit inside the outline and add more complete motifs in the remaining corners — do not crop a rectangular scene, and do not float a smaller trapezoid inside the part.`
  }

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
${themeLine(description, regionCount)}

How to read the PNG:
- Light gray pixels = the die-cut silhouette. This is the only place you may draw.
- Magenta ${CHROMA_KEY.hex} is outside the part. Keep every magenta pixel exactly magenta.
- Holes in the silhouette (counters in letters, screw holes) stay magenta.

${regionLine(regionCount)}

How to compose — this is NOT a mask over a larger picture:
- Invent artwork whose silhouette IS this shape. Like a custom inlay or die-cut sticker.
- Fill all space to the light-gray edges. Do not leave a blank margin or a smaller shape floating inside.
- GOOD: complete motifs arranged along this outline (and around notches/holes), reaching the edges.
- BAD: cropping a rectangular gear scene, cookie-cutting a texture, or insetting a smaller trapezoid.
- If a motif would be sliced by the silhouette, shrink it or add another complete motif so the region stays full.
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
