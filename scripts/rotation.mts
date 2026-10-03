// TASK-065 — persistent provider rotation and dispatch outcome state.
// The JSONL journal is append-only: one O_APPEND write owns one complete event.

import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

type Availability = 'in' | 'out' | 'unproven'
type OutcomeClass = 'quota' | 'persona' | 'transient' | 'ok' | 'unknown'

interface OutcomeEvent {
  readonly ev: 'outcome'
  readonly at: string
  readonly persona: string
  readonly provider: string
  readonly class: OutcomeClass
  readonly evidence: string
  readonly source: string
  readonly until?: string
}

interface RetryEvent {
  readonly ev: 'retry'
  readonly at: string
  readonly provider?: string
  readonly persona?: string
  readonly reason: string
}

interface AssignEvent {
  readonly ev: 'assign'
  readonly at: string
  readonly item: string
  readonly family: string
  readonly persona: string
  readonly provider: string
  readonly how: 'rotation' | 'item' | 'review' | 'override' | 'reassign'
  readonly reason?: string
}

interface SkipEvent {
  readonly ev: 'skip'
  readonly at: string
  readonly item: string
  readonly persona: string
  readonly reason: string
}

export type RotationEvent = OutcomeEvent | RetryEvent | AssignEvent | SkipEvent

interface AvailabilityDetail {
  state: Availability
  since?: string
  reason?: string
  source?: string
  until?: string
}

export interface Classification {
  readonly class: OutcomeClass
  readonly evidence: string
  readonly until?: string
}

export interface RotationState {
  providers: Record<string, AvailabilityDetail>
  personas: Record<string, AvailabilityDetail>
  familyPointers: Record<string, string>
  itemProviders: Record<string, string>
}

const CODE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const STATE_DIR_LIB = join(CODE_ROOT, 'scripts/lib/state-dir.sh')
const ROSTER_LIB = join(CODE_ROOT, 'scripts/lib/roster.sh')

function stdout(text: string): void { writeSync(1, text) }
function stderr(text: string): void { writeSync(2, text) }

interface RosterRow {
  readonly role: string
  readonly family: string
  readonly persona: string
  readonly provider: string
}

function stateDir(): string {
  const result = spawnSync(
    'sh',
    ['-c', '. "$1"; BP_STATE_ROOT="$(bp_state_root)" || exit 9; agent_state_dir', 'sh', STATE_DIR_LIB],
    { encoding: 'utf8', env: { ...process.env, BP_CODE_ROOT: CODE_ROOT }, stdio: ['ignore', 'pipe', 'inherit'] },
  )
  if (result.status !== 0) process.exit(9)
  return result.stdout.trim()
}

function rotationLog(): string {
  return join(stateDir(), 'rotation.log')
}

function familyOf(role: string): string {
  return role.replace(/-\d+$/, '')
}

function rosterRows(): RosterRow[] {
  const source = process.env.AGENT_ROSTER_FILE || CODE_ROOT
  const result = spawnSync(
    'bash',
    ['-c', '. "$1"; bp_roster_rows "$2"', 'bash', ROSTER_LIB, source],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  )
  if (result.status !== 0) process.exit(2)
  return result.stdout.trimEnd().split('\n').filter(Boolean).map((line) => {
    const [role = '', persona = '', provider = ''] = line.split('\t')
    return { role, family: familyOf(role), persona, provider }
  })
}

function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function readEvents(path: string, report: (message: string) => void = (message) => stderr(`${message}\n`)): RotationEvent[] {
  if (!existsSync(path)) return []
  const content = readFileSync(path, 'utf8')
  const complete = content.endsWith('\n') ? content.slice(0, -1).split('\n') : content.split('\n').slice(0, -1)
  const events: RotationEvent[] = []
  complete.forEach((line, index) => {
    if (line === '') return
    try {
      events.push(JSON.parse(line) as RotationEvent)
    } catch {
      // reported on stderr below, never silently dropped
      report(`rotation: malformed complete record at ${path} line ${index + 1}; skipped`)
    }
  })
  return events
}

export function appendEvent(path: string, event: RotationEvent): void {
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a' })
}

function detail(state: Availability, event: OutcomeEvent | RetryEvent): AvailabilityDetail {
  const result: AvailabilityDetail = { state, since: event.at }
  if ('evidence' in event) {
    result.reason = event.evidence
    result.source = event.source
    if (event.until !== undefined) result.until = event.until
  } else {
    result.reason = event.reason
  }
  return result
}

export function foldEvents(events: readonly RotationEvent[], now: Date = new Date()): RotationState {
  const state: RotationState = { providers: {}, personas: {}, familyPointers: {}, itemProviders: {} }
  for (const event of events) {
    if (event.ev === 'outcome') {
      if (event.class === 'quota') state.providers[event.provider] = detail('out', event)
      if (event.class === 'persona') state.personas[event.persona] = detail('out', event)
      if (event.class === 'ok') {
        state.providers[event.provider] = detail('in', event)
        state.personas[event.persona] = detail('in', event)
      }
    } else if (event.ev === 'retry') {
      if (event.provider !== undefined) state.providers[event.provider] = detail('unproven', event)
      if (event.persona !== undefined) state.personas[event.persona] = detail('unproven', event)
    } else if (event.ev === 'assign') {
      state.familyPointers[event.family] = event.provider
      if (event.how !== 'review') state.itemProviders[event.item] = event.provider
    }
  }
  for (const value of Object.values(state.providers)) {
    if (value.state === 'out' && value.until !== undefined && Date.parse(value.until) <= now.getTime()) {
      value.state = 'unproven'
    }
  }
  return state
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index < 0 ? undefined : args[index + 1]
}

function options(args: readonly string[], name: string): string[] {
  const values: string[] = []
  args.forEach((arg, index) => { if (arg === name && args[index + 1] !== undefined) values.push(args[index + 1] as string) })
  return values
}

function required(value: string | undefined, message: string): string {
  if (value !== undefined && value !== '') return value
  stderr(`rotation: ${message}\n`)
  process.exit(2)
}

function withCooldown(classification: OutcomeClass, evidence: string, now: Date, hours?: number): Classification {
  if (hours === undefined) return { class: classification, evidence }
  return { class: classification, evidence, until: new Date(now.getTime() + hours * 3_600_000).toISOString() }
}

function lastLine(lines: readonly string[], predicate: (line: string) => boolean): string | undefined {
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]
    if (line !== undefined && predicate(line)) return line
  }
  return undefined
}

export function classifyOutput(provider: string, content: string, exitCode: number, now: Date = new Date()): Classification {
  const lines = content.split('\n')
  const evidence = lines.find((line) => line !== '') ?? ''
  if (exitCode === 0) return withCooldown('ok', lastLine(lines, (line) => line.includes('finished')) ?? evidence, now)

  if (provider === 'Gemini') {
    const index = lines.findIndex((line) =>
      /^Error when talking to Gemini API Full report available at: \S+ TerminalQuotaError: You have exhausted your daily quota/.test(line),
    )
    if (index >= 0 && /^    at classifyGoogleError \(/.test(lines[index + 1] ?? '')) {
      return withCooldown('quota', lines[index] as string, now, 24)
    }
  }

  for (const line of lines) {
    if (provider === 'Kimi' && /^error: failed to run prompt: provider\.auth_error: 403 You've reached your 5-hour usage limit/.test(line)) {
      return withCooldown('quota', line, now, 5)
    }
    if (provider === 'Codex' && /^⚠ You've hit your usage limit/.test(line)) {
      return withCooldown('quota', line, now, 5)
    }
    if (provider === 'Claude Code' && /^You've hit your session limit/.test(line)) {
      return withCooldown('quota', line, now, 5)
    }
    if (provider === 'Codex' && /^⚠ \{"type":"error","status":400,.*is not supported when using Codex/.test(line)) {
      return withCooldown('persona', line, now)
    }
    if (/^[^\s].* — dispatch refused(?::|$)/.test(line)) return withCooldown('persona', line, now)
    if (provider === 'Codex' && /^⚠ Selected model is at capacity/.test(line)) {
      return withCooldown('transient', line, now)
    }
  }
  return withCooldown('unknown', lastLine(lines, (line) => line !== '') ?? '', now)
}

function record(args: readonly string[]): void {
  const persona = required(args[0], 'record needs a persona')
  const outputOption = option(args, '--output')
  const runLogOption = option(args, '--run-log')
  if ((outputOption === undefined) === (runLogOption === undefined)) {
    required(undefined, 'record needs exactly one of --output <file> or --run-log <file>')
  }
  const output = (outputOption ?? runLogOption) as string
  const from = runLogOption === undefined ? 0 : Number(required(option(args, '--from'), '--run-log needs --from <offset>'))
  if (!Number.isInteger(from) || from < 0) required(undefined, '--from must be a non-negative integer')
  const provider = process.env.AGENT_PROVIDER || rosterRows().find((row) => row.persona === persona)?.provider || persona
  const content = readFileSync(output).subarray(from).toString('utf8')
  const exitText = outputOption === undefined
    ? content.match(/(?:finished|FAILED \(exit (\d+)\))[^\n]*\n?$/)?.[1] ?? (/(?:^|\n)[^\n]*finished[^\n]*\n?$/.test(content) ? '0' : undefined)
    : option(args, '--exit')
  const exitCode = Number(required(exitText, 'record could not determine the dispatch exit status'))
  if (!Number.isInteger(exitCode)) required(undefined, '--exit must be an integer')
  const classification = classifyOutput(provider, content, exitCode)
  const event: OutcomeEvent = {
    ev: 'outcome', at: isoNow(), persona, provider, class: classification.class,
    evidence: classification.evidence, source: `${output}@${from}`,
    ...(classification.until === undefined ? {} : { until: classification.until }),
  }
  appendEvent(rotationLog(), event)
  stdout(`${classification.class}\n`)
}

function availability(name: string, values: Readonly<Record<string, AvailabilityDetail>>): AvailabilityDetail {
  return values[name] ?? { state: 'in' }
}

function eligible(row: RosterRow, state: RotationState, skipped: ReadonlySet<string>): boolean {
  return availability(row.provider, state.providers).state !== 'out' &&
    availability(row.persona, state.personas).state !== 'out' && !skipped.has(row.persona)
}

function orderedAfter(rows: readonly RosterRow[], provider: string | undefined): RosterRow[] {
  if (provider === undefined) return [...rows]
  const index = rows.findIndex((row) => row.provider === provider)
  if (index < 0) return [...rows]
  return [...rows.slice(index + 1), ...rows.slice(0, index + 1)]
}

function explainUnavailable(rows: readonly RosterRow[], state: RotationState): void {
  for (const row of rows) {
    const provider = availability(row.provider, state.providers)
    const persona = availability(row.persona, state.personas)
    const unavailable = provider.state === 'out' ? provider : persona.state === 'out' ? persona : undefined
    if (unavailable !== undefined) {
      stderr(`rotation: skipping ${row.persona} (${row.provider}): ${unavailable.reason ?? 'out'} [${unavailable.source ?? 'unknown source'}]\n`)
    }
  }
}

function printPick(row: RosterRow): void {
  stdout(`${row.persona}\t${row.provider}\t${row.family}\n`)
}

function itemAssignment(events: readonly RotationEvent[], item: string): AssignEvent | undefined {
  let found: AssignEvent | undefined
  for (const event of events) if (event.ev === 'assign' && event.item === item && event.how !== 'review') found = event
  return found
}

function parseSkips(args: readonly string[], item: string, log: string, events: readonly RotationEvent[]): Set<string> {
  const skipped = new Set<string>()
  for (const event of events) if (event.ev === 'skip' && event.item === item) skipped.add(event.persona)
  for (const value of options(args, '--skip')) {
    const separator = value.indexOf('=')
    if (separator <= 0) required(undefined, '--skip must be <persona>=<reason>')
    const persona = value.slice(0, separator)
    const reason = value.slice(separator + 1)
    if (!skipped.has(persona)) appendEvent(log, { ev: 'skip', at: isoNow(), item, persona, reason })
    skipped.add(persona)
  }
  return skipped
}

function next(args: readonly string[]): void {
  const family = required(args[0], 'next needs a family')
  const item = required(option(args, '--item'), 'next needs --item <ID>')
  const log = rotationLog()
  const events = readEvents(log)
  const state = foldEvents(events)
  const rows = rosterRows().filter((row) => row.family === family)
  const skipped = parseSkips(args, item, log, events)
  if (rows.length === 0) {
    stderr(`rotation: ${family}: the roster has no personas in this family — hold, or tell the founder the role is short.\n`)
    process.exit(3)
  }
  explainUnavailable(rows, state)
  const assigned = itemAssignment(events, item)
  if (assigned !== undefined) {
    const sameProvider = rows.find((row) => row.provider === assigned.provider && eligible(row, state, skipped))
    if (sameProvider !== undefined) {
      if (assigned.family !== family) appendEvent(log, { ev: 'assign', at: isoNow(), item, family, persona: sameProvider.persona, provider: sameProvider.provider, how: 'item' })
      if (availability(sameProvider.provider, state.providers).state === 'unproven') stderr(`rotation: ${sameProvider.provider}: this dispatch is the probe\n`)
      printPick(sameProvider)
      return
    }
    if (option(args, '--hold') !== undefined || args.includes('--hold')) {
      stderr(`rotation: ${item}'s provider ${assigned.provider} is out; --hold keeps the item assigned until it returns.\n`)
      process.exit(5)
    }
  }
  const pick = orderedAfter(rows, state.familyPointers[family]).find((row) => eligible(row, state, skipped))
  if (pick === undefined) {
    stderr(`rotation: ${family}: no eligible persona — hold, or tell the founder the role is short.\n`)
    process.exit(3)
  }
  const how = assigned === undefined ? 'rotation' : 'reassign'
  const reason = assigned === undefined ? undefined : `${assigned.provider} is unavailable; item reassigned by D1`
  appendEvent(log, { ev: 'assign', at: isoNow(), item, family, persona: pick.persona, provider: pick.provider, how, ...(reason === undefined ? {} : { reason }) })
  if (availability(pick.provider, state.providers).state === 'unproven') stderr(`rotation: ${pick.provider}: this dispatch is the probe\n`)
  printPick(pick)
}

function review(args: readonly string[]): void {
  const family = required(args[0], 'review needs a family')
  const item = required(option(args, '--item'), 'review needs --item <ID>')
  const log = rotationLog()
  const events = readEvents(log)
  const state = foldEvents(events)
  const authorName = option(args, '--author')
  const authorProvider = itemAssignment(events, item)?.provider ??
    (authorName === undefined ? undefined : rosterRows().find((row) => row.persona === authorName)?.provider)
  const provider = required(authorProvider, `review has no author provider for ${item}; pass --author <persona>`)
  const rows = rosterRows().filter((row) => row.family === family)
  const pick = orderedAfter(rows, state.familyPointers[family]).find((row) => row.provider !== provider && eligible(row, state, new Set()))
  if (pick === undefined) {
    stderr(`rotation: four-eyes cannot be satisfied for ${item}: author provider ${provider} is the only one with an eligible ${family} persona — hold the push and tell the founder; a waiver is the founder's.\n`)
    process.exit(4)
  }
  appendEvent(log, { ev: 'assign', at: isoNow(), item, family, persona: pick.persona, provider: pick.provider, how: 'review' })
  printPick(pick)
}

function assign(args: readonly string[]): void {
  const persona = required(args[0], 'assign needs a persona')
  const item = required(option(args, '--item'), 'assign needs --item <ID>')
  const reason = required(option(args, '--reason'), 'assign needs --reason <text>')
  const row = rosterRows().find((candidate) => candidate.persona === persona)
  if (row === undefined) {
    stderr(`rotation: persona ${persona} is not in the roster\n`)
    process.exit(2)
  }
  appendEvent(rotationLog(), { ev: 'assign', at: isoNow(), item, family: row.family, persona: row.persona, provider: row.provider, how: 'override', reason })
  printPick(row)
}

function coverage(args: readonly string[]): void {
  const wanted = args[0]
  const state = foldEvents(readEvents(rotationLog()))
  const grouped = new Map<string, RosterRow[]>()
  for (const row of rosterRows()) {
    if (wanted !== undefined && row.family !== wanted) continue
    grouped.set(row.family, [...(grouped.get(row.family) ?? []), row])
  }
  for (const [family, rows] of grouped) {
    const availableProviders = new Set<string>()
    stdout(`${family}${rows.length < 2 ? ' — no rotation' : ''}\n`)
    for (const row of rows) {
      const provider = availability(row.provider, state.providers)
      const persona = availability(row.persona, state.personas)
      const current = provider.state === 'out' ? provider : (persona.state === 'out' ? persona : (provider.state === 'unproven' ? provider : persona))
      if (provider.state !== 'out' && persona.state !== 'out') availableProviders.add(row.provider)
      stdout(`  ${row.persona}\t${row.provider}\t${current.state}${current.reason === undefined ? '' : ` — ${current.reason}`}${current.source === undefined ? '' : ` [${current.source}]`}\n`)
    }
    if (availableProviders.size < 2 && rows.length >= 2) stdout('  WARNING: fewer than two available providers; four-eyes cannot be satisfied\n')
  }
}

function retry(args: readonly string[]): void {
  const target = required(args[0], 'retry needs a provider or persona')
  const reason = required(option(args, '--reason'), 'retry needs --reason <text>')
  const events = readEvents(rotationLog())
  const knownPersona = events.some((event) => event.ev === 'outcome' && event.persona === target)
  const base = { ev: 'retry' as const, at: isoNow(), reason }
  appendEvent(rotationLog(), knownPersona ? { ...base, persona: target } : { ...base, provider: target })
}

function main(args: readonly string[]): void {
  const command = args[0]
  if (command === 'record') record(args.slice(1))
  else if (command === 'retry') retry(args.slice(1))
  else if (command === 'next') next(args.slice(1))
  else if (command === 'review') review(args.slice(1))
  else if (command === 'assign') assign(args.slice(1))
  else if (command === 'coverage') coverage(args.slice(1))
  else {
    stderr('Usage: node scripts/rotation.mts <next|review|assign|record|retry|coverage> ...\n')
    process.exit(2)
  }
}

if (process.argv[1] !== undefined &&
    (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) || process.argv[1].endsWith('/rotation.mts'))) {
  main(process.argv.slice(2))
}
