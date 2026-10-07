// The pending check (docs/concept/testing.md#pending-check).
//
// The runner has no strict "expected to fail", so this wrapper reads the runner's
// JSON output and decides whether the gate passes:
//
//   tagged for a later slice, fails on a skeleton step or an assertion -> pending
//   tagged, but passes                                                  -> gate fails
//   untagged, fails                                                     -> gate fails
//   undefined or ambiguous step, import error, other error, no output   -> gate fails
import { spawnSync } from 'node:child_process'

interface Step {
  keyword: string
  name?: string
  result?: { status: string; error_message?: string }
}
interface Element {
  type?: string
  name?: string
  tags?: { name: string }[]
  steps?: Step[]
  before?: Step[]
  after?: Step[]
}
interface Feature {
  uri?: string
  elements?: Element[]
}

export interface Verdict {
  ok: boolean
  scenarios: number
  pending: number
  /** Pending scenarios per slice tag, such as "@slice-2". */
  pendingPerSlice: Record<string, number>
  failures: string[]
}

const SLICE_TAG = /^@slice-\d+$/

function firstLine(message: string | undefined): string {
  return (message ?? '').trim().split('\n')[0] ?? ''
}

/** Judges one scenario. Returns a failure text, "pending", or "ok". */
function judgeScenario(el: Element): string {
  const sliceTags = (el.tags ?? []).map((t) => t.name).filter((t) => SLICE_TAG.test(t))
  if (sliceTags.length > 1) return `carries more than one slice tag (${sliceTags.join(', ')})`
  const results = [...(el.before ?? []), ...(el.steps ?? []), ...(el.after ?? [])].map(
    (s) => s.result,
  )
  for (const r of results) {
    if (r?.status === 'undefined' || r?.status === 'ambiguous') {
      return `has a step that is ${r.status}: a broken harness cannot pass as pending`
    }
    if (!r || !['passed', 'failed', 'skipped'].includes(r.status)) {
      return `has a step with status "${r?.status}": a broken harness cannot pass as pending`
    }
  }
  const failed = results.filter((r) => r?.status === 'failed')
  if (failed.length === 0) {
    if (results.some((r) => r?.status === 'skipped')) return 'was skipped without a failing step'
    return sliceTags.length === 0
      ? 'ok'
      : `passes: remove its tag ${sliceTags[0]} in the slice that delivers it`
  }
  if (sliceTags.length === 0) return `is untagged and fails: ${firstLine(failed[0]?.error_message)}`
  for (const r of failed) {
    const line = firstLine(r?.error_message)
    if (!line.startsWith('NotBuilt') && !line.startsWith('AssertionError')) {
      return `fails with something other than a skeleton step or an assertion: ${line}`
    }
  }
  return 'pending'
}

/** Judges the raw output of `cucumber-js --format json`. */
export function judge(output: string): Verdict {
  const verdict: Verdict = {
    ok: false,
    scenarios: 0,
    pending: 0,
    pendingPerSlice: {},
    failures: [],
  }
  let report: Feature[]
  try {
    report = JSON.parse(output) as Feature[]
    if (!Array.isArray(report)) throw new Error('not a list of features')
  } catch {
    verdict.failures.push('the runner gave no usable output (an import error, or no output at all)')
    return verdict
  }
  for (const feature of report) {
    for (const el of feature.elements ?? []) {
      if (el.type !== 'scenario') continue
      verdict.scenarios++
      const outcome = judgeScenario(el)
      if (outcome === 'pending') {
        verdict.pending++
        const tag = (el.tags ?? []).map((t) => t.name).find((t) => SLICE_TAG.test(t)) as string
        verdict.pendingPerSlice[tag] = (verdict.pendingPerSlice[tag] ?? 0) + 1
      } else if (outcome !== 'ok') {
        verdict.failures.push(`${feature.uri}: scenario "${el.name}" ${outcome}`)
      }
    }
  }
  if (verdict.scenarios === 0) verdict.failures.push('the runner ran no scenario')
  verdict.ok = verdict.failures.length === 0
  return verdict
}

function print(v: Verdict): void {
  const slices = Object.keys(v.pendingPerSlice).sort(
    (a, b) => Number(a.slice(7)) - Number(b.slice(7)),
  )
  for (const s of slices) console.log(`pending ${s}: ${v.pendingPerSlice[s]}`)
  console.log(
    `${v.scenarios} scenarios, ${v.pending} pending, ${v.scenarios - v.pending} not pending`,
  )
  for (const f of v.failures) console.error(`FAIL ${f}`)
  console.log(v.ok ? 'pending check: PASSED' : 'pending check: FAILED')
}

if (import.meta.main) {
  const run = spawnSync(
    process.execPath,
    ['node_modules/@cucumber/cucumber/bin/cucumber.js', '--format', 'json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  const verdict = judge(run.stdout)
  if (!verdict.ok && run.stderr)
    console.error(run.stderr.trim().split('\n').slice(0, 20).join('\n'))
  print(verdict)
  process.exit(verdict.ok ? 0 : 1)
}
