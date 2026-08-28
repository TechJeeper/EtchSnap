import { sanitizeSvg } from './svgUtils.ts'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function testLaserSvgPunchesHolesAndDropsStroke(): void {
  const svg = [
    '<svg width="10" height="10">',
    '<path fill="rgb(0,0,0)" stroke="rgb(0,0,0)" stroke-width="0" d="M 0 0 L 10 0 L 10 10 L 0 10 Z M 3 3 L 7 3 L 7 7 L 3 7 Z" />',
    '<path fill="rgb(255,255,255)" d="M 0 0 L 10 0 L 10 10 L 0 10 Z" />',
    '</svg>',
  ].join('')

  const out = sanitizeSvg(svg, 10, 10, 5, 5, 'laser')
  assert(/fill-rule="evenodd"/.test(out), 'laser paths must use evenodd so holes punch through')
  assert(/stroke="none"/.test(out), 'laser paths must not keep a matching stroke that fills the shape')
  assert(!/rgb\(255,\s*255,\s*255\)/.test(out), 'white background paths must be removed')
  assert(/viewBox="0 0 10 10"/.test(out), 'viewBox should keep traced coordinates')
  assert(/width="5"/.test(out) && /height="5"/.test(out), 'display size should stay at the original crop')
}

const tests = [['laser svg punches holes and drops stroke', testLaserSvgPunchesHolesAndDropsStroke]] as const

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
console.log(`\n${tests.length - failed}/${tests.length} svg utils tests passed`)
