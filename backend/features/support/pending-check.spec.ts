import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { judge } from './pending-check.ts'

type Status = 'passed' | 'failed' | 'skipped' | 'undefined' | 'ambiguous' | 'pending'

const NOT_BUILT = 'NotBuilt: This step is not built yet.\n    at notBuilt (not-built.ts:1:1)'
const ASSERTION = 'AssertionError [ERR_ASSERTION]: expected 1 to equal 2\n    at step (a.ts:1:1)'

function step(status: Status, error?: string) {
  return { keyword: 'Given ', result: { status, ...(error ? { error_message: error } : {}) } }
}

function output(...scenarios: { tags?: string[]; steps: ReturnType<typeof step>[] }[]): string {
  return JSON.stringify([
    {
      uri: 'features/a.feature',
      elements: scenarios.map((s, i) => ({
        type: 'scenario',
        name: `scenario ${i}`,
        tags: (s.tags ?? []).map((name) => ({ name })),
        steps: s.steps,
      })),
    },
  ])
}

const tagged = (...steps: ReturnType<typeof step>[]) => ({ tags: ['@slice-2'], steps })
const untagged = (...steps: ReturnType<typeof step>[]) => ({ steps })

describe('pending check', () => {
  describe('row 1: tagged, fails on a skeleton step or on an assertion', () => {
    it('is pending, counted per slice', () => {
      const v = judge(
        output(
          tagged(step('failed', NOT_BUILT), step('skipped')),
          tagged(step('passed'), step('failed', ASSERTION)),
          { tags: ['@slice-5'], steps: [step('failed', NOT_BUILT)] },
        ),
      )
      assert.equal(v.ok, true)
      assert.equal(v.scenarios, 3)
      assert.equal(v.pending, 3)
      assert.deepEqual(v.pendingPerSlice, { '@slice-2': 2, '@slice-5': 1 })
    })
  })

  describe('row 2: tagged, but passes', () => {
    it('fails the gate: the tag must go in the slice that delivers it', () => {
      const v = judge(output(tagged(step('passed'), step('passed'))))
      assert.equal(v.ok, false)
      assert.match(v.failures[0] as string, /remove its tag @slice-2/)
    })
  })

  describe('row 3: untagged, fails', () => {
    it('fails the gate', () => {
      const v = judge(output(untagged(step('failed', ASSERTION))))
      assert.equal(v.ok, false)
      assert.match(v.failures[0] as string, /untagged and fails/)
    })
    it('lets an untagged scenario that passes through', () => {
      const v = judge(output(untagged(step('passed'))))
      assert.equal(v.ok, true)
      assert.equal(v.pending, 0)
    })
  })

  describe('row 4: a broken harness cannot pass as pending', () => {
    it('fails on an undefined step, even in a scenario that fails earlier', () => {
      const v = judge(output(tagged(step('failed', NOT_BUILT), step('undefined'))))
      assert.equal(v.ok, false)
      assert.match(v.failures[0] as string, /undefined/)
    })
    it('fails on an ambiguous step', () => {
      const v = judge(output(tagged(step('ambiguous'))))
      assert.equal(v.ok, false)
      assert.match(v.failures[0] as string, /ambiguous/)
    })
    it('fails on a pending step of the runner', () => {
      assert.equal(judge(output(tagged(step('pending')))).ok, false)
    })
    it('fails on any other error, even in a tagged scenario', () => {
      const v = judge(output(tagged(step('failed', 'TypeError: x is not a function\n    at a'))))
      assert.equal(v.ok, false)
      assert.match(v.failures[0] as string, /something other than a skeleton step/)
    })
    it('fails on an import error, which gives no output', () => {
      assert.equal(judge('').ok, false)
    })
    it('fails on output that is not the runner report', () => {
      assert.equal(judge('Error: Cannot find module').ok, false)
      assert.equal(judge('{}').ok, false)
    })
    it('fails when no scenario ran', () => {
      assert.equal(judge('[]').ok, false)
    })
  })

  describe('the slice tag', () => {
    it('fails a scenario that names two slices', () => {
      const v = judge(
        output({ tags: ['@slice-2', '@slice-3'], steps: [step('failed', NOT_BUILT)] }),
      )
      assert.equal(v.ok, false)
    })
    it('ignores other tags', () => {
      const v = judge(output({ tags: ['@slice-2', '@other'], steps: [step('failed', NOT_BUILT)] }))
      assert.equal(v.ok, true)
    })
  })
})
