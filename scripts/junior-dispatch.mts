#!/usr/bin/env node

/**
 * Run one locally hosted junior persona and publish its answer through the same
 * feed writer as the provider watchers.
 *
 * The roster lookup deliberately goes through scripts/lib/roster.sh. Ollama
 * cells contain literal model names (for example `qwen3-coder-64k:latest`),
 * whereas bp_roster_model_for_name resolves the frontier aliases used by the
 * remote providers. bp_roster_rows is therefore the canonical resolver for
 * this one literal-model backing; no Markdown parsing is duplicated here.
 * Blank answer lines are omitted from the activity feed; the run log preserves
 * the complete cleaned output.
 */

import { spawn, spawnSync } from 'node:child_process'
import { writeSync } from 'node:fs'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scratchTmpDir } from './lib/scratch-tmpdir.mts'

const codeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rosterLib = join(codeRoot, 'scripts', 'lib', 'roster.sh')
const feedLib = join(codeRoot, 'scripts', 'lib', 'feed.sh')
// TASK-083: the locally hosted Ollama junior's temporary files land under
// <repo>/.scratch/tmp, never /tmp — same rule, same mechanism (TMPDIR) as
// the three provider launchers.
const juniorTmpDir = scratchTmpDir(codeRoot)

interface Options {
  persona: string
  brief: string
}

function usage(message?: string): never {
  if (message) writeSync(process.stderr.fd, `junior-dispatch: ${message}\n`)
  writeSync(
    process.stderr.fd,
    'usage: node scripts/junior-dispatch.mts --persona <Name> --brief <file>\n',
  )
  process.exit(2)
}

function parseArgs(argv: string[]): Options {
  let persona = ''
  let brief = ''
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--persona') persona = argv[++i] ?? ''
    else if (arg === '--brief') brief = argv[++i] ?? ''
    else usage(`unknown argument '${arg}'`)
  }
  if (!persona) usage('--persona is required')
  if (!brief) usage('--brief is required')
  return { persona, brief }
}

function rosterModel(stateRoot: string, persona: string): string {
  const script = `
. "$1" || exit 9
bp_roster_rows "$2" || exit $?
`
  const lookup = spawnSync('bash', ['-c', script, 'junior-dispatch', rosterLib, stateRoot], {
    encoding: 'utf8',
    env: process.env,
  })
  if (lookup.status !== 0) {
    const detail = lookup.stderr.trim() || `roster lookup exited ${lookup.status ?? 'unknown'}`
    throw new Error(detail)
  }

  const wanted = persona.toLocaleLowerCase('en-US')
  const row = lookup.stdout
    .split('\n')
    .map((line) => line.split('\t'))
    .find((fields) => (fields[1] ?? '').toLocaleLowerCase('en-US') === wanted)
  if (!row) throw new Error(`${persona}: not on the roster`)

  const backing = row[2] ?? ''
  const model = row[3] ?? ''
  if (backing !== 'Ollama') {
    throw new Error(`${persona}: backing agent is '${backing || '<empty>'}', not Ollama`)
  }
  if (!model) throw new Error(`${persona}: Ollama roster row has no model`)
  return model
}

function feedAppend(stateRoot: string, line: string): void {
  const script = `
BP_STATE_ROOT="$2"
. "$1" || exit 9
feed_append "$3"
`
  const result = spawnSync('bash', ['-c', script, 'junior-dispatch', feedLib, stateRoot, line], {
    encoding: 'utf8',
    env: process.env,
  })
  if (result.stderr) writeSync(process.stderr.fd, result.stderr)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Render the CSI cursor/erase operations Ollama uses for streaming redraws. */
function cleanTerminalOutput(raw: string): string {
  const trailingNewline = raw.endsWith('\n')
  const lines = ['']
  let line = 0
  let column = 0
  const put = (value: string) => {
    const current = lines[line] ?? ''
    lines[line] = current.padEnd(column, ' ').slice(0, column) + value + current.slice(column + value.length)
    column += value.length
  }

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index] ?? ''
    if (character === '\u001b' && raw[index + 1] === '[') {
      index += 2
      let sequence = ''
      while (index < raw.length && !/[\u0040-\u007e]/.test(raw[index] ?? '')) {
        sequence += raw[index] ?? ''
        index += 1
      }
      const final = raw[index] ?? ''
      const parameter = Number.parseInt(sequence.replace(/^\?/, '').split(';')[0] || '1', 10)
      if (final === 'G') column = Math.max(0, parameter - 1)
      else if (final === 'D') column = Math.max(0, column - parameter)
      else if (final === 'K' && (sequence === '' || sequence === '0')) lines[line] = (lines[line] ?? '').slice(0, column)
      continue
    }
    if (character === '\r') column = 0
    else if (character === '\n') {
      line += 1
      lines[line] = ''
      column = 0
    } else if (character >= ' ') put(character)
  }

  while (lines.length > 1 && lines.at(-1) === '') lines.pop()
  return lines.join('\n') + (trailingNewline ? '\n' : '')
}

async function runOllama(model: string, brief: string): Promise<{ output: string; status: number }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn('ollama', ['run', '--nowordwrap', model], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TMPDIR: juniorTmpDir },
    })
    const chunks: string[] = []
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => chunks.push(chunk))
    child.stderr.on('data', (chunk: string) => chunks.push(chunk))
    child.once('error', rejectRun)
    child.once('close', (code) => {
      resolveRun({
        output: cleanTerminalOutput(chunks.join('')),
        status: code ?? 1,
      })
    })
    child.stdin.end(brief, 'utf8')
  })
}

async function main(): Promise<number> {
  const { persona, brief: briefPath } = parseArgs(process.argv.slice(2))
  const stateRoot = resolve(process.env.BP_STATE_ROOT || process.cwd())
  const model = rosterModel(stateRoot, persona)
  const brief = await readFile(resolve(briefPath), 'utf8')

  feedAppend(stateRoot, `[${persona} - Ollama] dispatched — ${briefPath}, model ${model}`)
  const started = Date.now()
  let terminalLine = `[${persona} - Ollama] FAILED (dispatcher ended without a result)`
  try {
    const result = await runOllama(model, brief)

    const runLog = join(stateRoot, 'logs', 'state', 'ollama-runs.log')
    await mkdir(dirname(runLog), { recursive: true })
    await appendFile(runLog, result.output, 'utf8')
    if (result.output) writeSync(process.stdout.fd, result.output)

    const lines = result.output.split('\n')
    if (lines.at(-1) === '') lines.pop()
    for (const line of lines) {
      if (line) feedAppend(stateRoot, `[${persona} - Ollama] ${line}`)
    }

    if (result.status === 0) {
      const seconds = Math.floor((Date.now() - started) / 1000)
      terminalLine = `[${persona} - Ollama] finished (exit 0, ${seconds}s)`
    } else {
      terminalLine = `[${persona} - Ollama] FAILED (exit ${result.status})`
    }
    return result.status
  } catch (error) {
    terminalLine = `[${persona} - Ollama] FAILED (${errorMessage(error)})`
    throw error
  } finally {
    feedAppend(stateRoot, terminalLine)
  }
}

try {
  process.exitCode = await main()
} catch (error) {
  writeSync(process.stderr.fd, `junior-dispatch: ${errorMessage(error)}\n`)
  process.exitCode = 2
}
