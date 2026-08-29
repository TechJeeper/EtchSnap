import { buildComplexityInstructions, buildPrompt } from './prompt.ts'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function testLaserComplexityAsksForMoreLinesNotSpeckle(): void {
  const simple = buildComplexityInstructions(10, 'laser')
  const complex = buildComplexityInstructions(100, 'laser')
  assert(/continuous/i.test(simple), 'simple laser complexity should mention continuous strokes')
  assert(/nested continuous|more unbroken|MORE UNBROKEN|pack the silhouette/i.test(complex), 'complex laser should pack lines')
  assert(!/small objects/i.test(complex), 'laser complexity must not ask for lots of tiny objects')
  assert(!/repeating texture fills/i.test(complex), 'laser complexity must not ban a contour field as texture')
}

function testUvComplexityStillBlocksCroppedTexture(): void {
  const complex = buildComplexityInstructions(100, 'uv')
  assert(/small objects|texture/i.test(complex), 'UV complex still steers away from cropped fills')
}

function testLaserPromptIncludesModeAwareComplexity(): void {
  const prompt = buildPrompt('topo map lines', 'laser', 90, undefined, 1, true, false, 1)
  assert(/continuous/i.test(prompt), 'laser prompt should keep continuous-stroke rules')
  assert(!/Use many complete small objects/i.test(prompt), 'high laser complexity should not request tiny objects')
}

const tests = [
  ['laser complexity asks for more lines not speckle', testLaserComplexityAsksForMoreLinesNotSpeckle],
  ['uv complexity still blocks cropped texture', testUvComplexityStillBlocksCroppedTexture],
  ['laser prompt includes mode-aware complexity', testLaserPromptIncludesModeAwareComplexity],
] as const

let failed = 0
for (const [name, run] of tests) {
  try {
    run()
    console.log(`ok  ${name}`)
  } catch (error) {
    failed += 1
    console.error(`fail  ${name}`)
    console.error(error instanceof Error ? error.message : error)
  }
}

if (failed > 0) process.exit(1)
console.log(`\n${tests.length - failed}/${tests.length} prompt tests passed`)
