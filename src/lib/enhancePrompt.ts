import type { OutputMode } from '../types'
import { getComplexityLabel } from './prompt'

function buildPrintableComplexity(complexity: number): string {
  if (complexity <= 20) {
    return `Keep it SIMPLE: a few bold shapes, thick lines, and almost no ornament. One clear focal subject.`
  }
  if (complexity <= 40) {
    return `Keep it LIGHT: clean graphic with modest supporting detail. Still easy to print or engrave.`
  }
  if (complexity <= 60) {
    return `Keep it BALANCED: a strong focal graphic with a little supporting detail, not a busy illustration.`
  }
  if (complexity <= 80) {
    return `Keep it DETAILED: more motifs and linework, but still a flat printable graphic with a readable silhouette.`
  }
  return `Keep it COMPLEX: denser graphic motifs and pattern, but never a scene or painting. The main subject must stay obvious.`
}

export function buildEnhancePrompt(
  description: string,
  mode: OutputMode,
  complexity: number,
): string {
  const productionGoal =
    mode === 'uv'
      ? `This is for a full-color UV print graphic: a decal that will be printed onto a real object later.
Use a limited bold color palette, solid color blocking, and clean edges.
Do not describe photorealism, painterly shading, cinematic lighting, or photographic texture.`
      : `This is for a laser-engraving graphic: black marks burned into a real object later.
Describe only continuous black strokes and solid filled shapes on a clear background, thick enough to engrave (no hairlines).
The design itself is black; empty space is not engraved. Do not describe a filled black plate with the design cut out in white.
Compose it to fill a selected surface, not as a centered square logo or stamp.
Do not describe stipple, dithering, sketchy dashes, gray, gradients, color, or photorealistic shading.`

  return `Rewrite the user's design idea into a short production brief for printable artwork.

${productionGoal}

User idea:
"${description}"

Target complexity: ${getComplexityLabel(complexity)}.
${buildPrintableComplexity(complexity)}

Primary objective: keep a UV/laser printable GRAPHIC of their subject. Improve clarity for production. Do not invent a new concept.

Write 1-2 short sentences that:
- Keep their subject as the single focal point
- Describe a flat graphic (emblem, icon, lettering, or ornament), not a picture of a world
- Add only production-useful detail: silhouette, fill vs outline, symmetry, line weight, color blocks
- Stay at the requested complexity

Do NOT:
- Add scenery, atmosphere, mood lighting, materials, cameras, or storytelling
- Mention the physical object, product, mockup, table, or surface it will go on
- Add borders, frames, background, transparency, or file formats
- Use AI-art jargon (masterpiece, 8k, octane, highly detailed, intricate, cinematic)
- Make a simple idea ornate, or bury the subject in extra motifs

Return ONLY the rewritten description text.`
}
