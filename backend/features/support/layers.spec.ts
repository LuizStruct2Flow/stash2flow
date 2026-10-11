// Proof that the layering rules bite: every bad-* file in lint-fixtures/ must be
// rejected, and every other file there accepted (so the rules are not blanket bans).
import assert from 'node:assert/strict'
import { basename } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import tseslint from 'typescript-eslint'
import { layers } from '../../eslint.layers.mjs'

const cwd = fileURLToPath(new URL('../../lint-fixtures/', import.meta.url))

const eslint = new ESLint({
  cwd,
  overrideConfigFile: true,
  overrideConfig: [tseslint.configs.base, ...layers],
})
const results = await eslint.lintFiles(['src/**/*.ts', 'features/**/*.ts'])

describe('layering lint', () => {
  it('finds the fixtures', () => {
    assert.ok(results.some((r) => basename(r.filePath).startsWith('bad-')))
  })

  for (const r of results) {
    const name = r.filePath.slice(cwd.length)
    const errors = r.messages.map((m) => `${m.ruleId}: ${m.message}`)
    if (basename(name).startsWith('bad-')) {
      it(`rejects ${name}`, () => assert.ok(errors.length > 0, 'accepted a wrong import'))
    } else {
      it(`accepts ${name}`, () => assert.deepEqual(errors, []))
    }
  }
})
