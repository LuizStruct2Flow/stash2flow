// scripts/lib/contamination.mts — guards the project → blueprint boundary (A-07).
// BUG-155 port of scripts/lib/contamination.sh, which it deletes (AGENTS.md
// §"Shell to TypeScript, organically"); `git log -- scripts/lib/contamination.sh`
// holds the shell file and the review history (A-07 R1–R6, Codex F1–F3) that
// this header only summarises.
//
// WHY THIS EXISTS. `blueprint pull` substitutes the project-name placeholder
// into a project's copy of a managed file, and `blueprint a2bp` copies that file
// back. Copied with a bare `cp`, one project's name, host paths and state dirs
// landed in the file every OTHER project pulls — BUG-002 (one project's state
// dir hardcoded in the generic activity feed) and A-09 (a literal, never-
// substituted per-project dir shared by every checkout) both arrived this way.
//
// Two primitives, deliberately separate:
//
//   contaminationStage — restores placeholders where a positional `diff`
//       alignment makes them attributable, then VERIFIES the result by
//       round-tripping it through THE forward substitution
//       (scripts/lib/placeholders.sh, reached across a process boundary, never
//       copied). It is not an inverse of substitution: four review rounds
//       established that no content-derived alignment recovers edit history.
//       What makes it safe is the round-trip check, not the attribution.
//   contaminationScan  — HEURISTIC, and the only thing between the project and
//       the blueprint. Every staged line is scanned; there is no alignment-
//       derived exemption, because an exemption is the one place a
//       misattribution could leak (R4-F2). The one override is a justified
//       `a2bp-allow: <why>` marker on the line itself, and a bare marker does
//       not suppress.
//
// THE CONTRACT, stated narrowly: on the default path a recognised BLOCK class
// cannot land; the one override is loud and auditable; staging never changes
// meaning under substitution (forward-substituting the staged result
// reproduces the project's file byte-for-byte, or staging fails closed). NOT
// claimed: that contamination is impossible.
//
// Callers: scripts/blueprint.mts (cmd_a2bp's staging loop) and
// scripts/contamination-push-scan.mts (CI, over a push's added lines). Both
// import this module; nothing runs it as a CLI.

import { spawnSync } from 'node:child_process'
import { accessSync, constants, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLACEHOLDERS = join(dirname(fileURLToPath(import.meta.url)), 'placeholders.sh')

// The placeholder is built, never spelled: this file is substitution-exempt
// (placeholders.sh bp_should_substitute), the same rule scripts/blueprint.mts
// follows, and a literal token here would also be the A-09 shape the dot-dir
// pass below blocks.
const PLACEHOLDER = ['{{', 'PROJECT_NAME', '}}'].join('')

// --- Well-known dot-directories -------------------------------------------
// Tool and shell dirs that are generic to every machine. Anything ELSE under
// ~/. or $HOME/. is a per-project state dir — the BUG-002 / A-09 shape: it
// must be derived at runtime via scripts/lib/state-dir.sh, never written
// literally into a generic file. The placeholder is deliberately NOT listed:
// after reverse-substitution a project's own dir becomes `~/.<placeholder>`,
// which is A-09 exactly (the shared literal dir every checkout collided on).
// `kimi-code` is the Kimi CLI's own home, the same class as `codex` and
// `gemini` (BUG-155; it joined the roster after the list was written).
const KNOWN_DOTDIRS = new Set(
  `aws bash_history bashrc cache claude codex config
copilot cursor docker gemini git gitconfig gitignore gnupg kimi-code kube local npm nvm
profile semgrep ssh vscode zshrc`.split(/\s+/),
)

// Emails are the one check that stays a NOTICE rather than a block. These are
// not even worth mentioning.
function isPlaceholderEmail(e: string): boolean {
  return (
    e.endsWith('@example.com') ||
    e.endsWith('@example.org') ||
    e.endsWith('@example.net') ||
    /@.*\.example$/.test(e) ||
    e === 'git@github.com' ||
    e.endsWith('@local') ||
    e.startsWith('noreply@')
  )
}

// bp_substitute_stream FILE NAME, THE forward substitution (placeholders.sh),
// reached across a process boundary. A refused file (NUL bytes, an
// unrepresentable name) yields no output, the primitive's own message on
// stderr, and a non-zero status.
function substituteStream(src: string, projName: string): { readonly out: Buffer; readonly status: number } {
  const r = spawnSync('bash', ['-c', '. "$1"; bp_substitute_stream "$2" "$3"', 'contamination', PLACEHOLDERS, src, projName], {
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 256 * 1024 * 1024,
  })
  return { out: r.stdout ?? Buffer.alloc(0), status: r.status ?? 127 }
}

// mapfile -t: one entry per line, the newline stripped, a missing final newline
// still yielding its line. latin1 keeps every byte as one char, so the staged
// output is byte-exact for any text.
function mapfile(file: string): string[] {
  const lines = readFileSync(file, 'latin1').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function endsWithoutNewline(file: string): boolean {
  const b = readFileSync(file)
  return b.length > 0 && b[b.length - 1] !== 0x0a
}

/**
 * contaminationStage PROJ_FILE BP_FILE NAME STAGED_OUT → exit status.
 *
 * Writes to STAGED_OUT the bytes that should land in the blueprint. Returns 0,
 * or non-zero if staging cannot be done safely: 2 when `diff` could not run
 * (the --*-line-format switches are GNU extensions; fail closed rather than
 * pretend the capability is there, R3-F3), 3 when the round-trip check fails.
 *
 * No blueprint copy (a brand-new managed file) → nothing to align against →
 * verbatim passthrough, and the scan judges every line.
 *
 * Alignment is positional: `diff`'s three --*-line-format options emit one
 * record per line in file order ('=' common, '-' only upstream, '+' only in the
 * project), and walking that stream with two counters yields, for every project
 * line, the upstream line it corresponds to. `%l` plus an explicit `%c'\012'`,
 * never `%L`, so an incomplete final line still produces a terminated record
 * (R3-F2). Nothing here compiles the project name as a regex.
 *
 * The caller owns the bp_should_substitute exemption: files that IMPLEMENT the
 * substitution carry the tokens as code, and restoring placeholders in them
 * would corrupt them.
 */
export function contaminationStage(pf: string, bpf: string, projName: string, stagedOut: string): number {
  if (!existsSync(bpf)) {
    copyFileSync(pf, stagedOut)
    return 0
  }
  // The reqLib bridge's point-of-use fallback for a missing placeholders.sh
  // (scripts/blueprint.mts placeholdersFallbackSnippet): die before anything
  // is staged.
  try {
    accessSync(PLACEHOLDERS, constants.R_OK)
  } catch {
    // Unreadable is the probed state; the message below is the whole answer.
    process.stderr.write('error: scripts/lib/placeholders.sh is missing — cannot substitute safely\n')
    return 1
  }

  const finalNl = !endsWithoutNewline(pf)
  const bpLines = mapfile(bpf)
  const projLines = mapfile(pf)

  const tmp = mkdtempSync(join(tmpdir(), 'contamination-'))
  try {
    // What `pull` would have produced from the blueprint's copy, with the
    // blueprint's own final-newline state preserved by the primitive: `diff`
    // treats a complete and an incomplete last line as different.
    // The shell never read the status here: a refused blueprint copy aligns
    // nothing, and the project file passes through verbatim to the scan.
    const bpSub = join(tmp, 'bp-sub')
    writeFileSync(bpSub, substituteStream(bpf, projName).out)

    const d = spawnSync(
      'diff',
      [
        "--unchanged-line-format==%l%c'\\012'",
        "--old-line-format=-%l%c'\\012'",
        "--new-line-format=+%l%c'\\012'",
        bpSub,
        pf,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 },
    )
    // diff exits 0 (identical) or 1 (differences). Anything else — an
    // unsupported option, an I/O error, a missing binary — is trouble.
    if (d.status === null || d.status > 1) return 2

    const align = new Map<number, number>()
    let bpI = 0
    let pjI = 0
    for (const rec of d.stdout.toString('latin1').split('\n')) {
      switch (rec[0]) {
        case '=':
          bpI++
          pjI++
          align.set(pjI, bpI)
          break
        case '-':
          bpI++
          break
        case '+':
          pjI++
          break
        default:
      }
    }

    // Emit the staged copy: an aligned project line is the blueprint's own line
    // (placeholders intact), anything else is the project's line verbatim.
    const n = projLines.length
    const out: string[] = []
    for (let i = 1; i <= n; i++) {
      const bp = align.get(i)
      const line = bp === undefined ? projLines[i - 1] : bpLines[bp - 1]
      out.push(line ?? '')
      if (i < n || finalNl) out.push('\n')
    }
    writeFileSync(stagedOut, Buffer.from(out.join(''), 'latin1'))

    // Round-trip verification, the safety property: forward-substituting the
    // staged output and the project's own file must give identical bytes. Both
    // sides are substituted, because a project file may legitimately already
    // contain the placeholder (it is what the operator is told to write when a
    // line blocks). Through THE primitive, not a local copy of it (R5-F1).
    //
    // A refusal on either side fails the round trip. The shell reached the same
    // verdict (3) on a NUL-bearing project file only because `mapfile` had
    // already dropped bytes from its staged copy, so the two refused (empty)
    // sides never got to compare equal; this port keeps every byte, so the
    // refusal has to be read, or two empty outputs would pass as a round trip.
    const vs = substituteStream(stagedOut, projName)
    const vp = substituteStream(pf, projName)
    if (vs.status !== 0 || vp.status !== 0 || !vs.out.equals(vp.out)) return 3
    return 0
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

export interface ScanResult {
  /** One finding per entry: `<lineno>|<BLOCK|NOTICE>|<reason>|<text>`. */
  readonly findings: readonly string[]
  /** True when any BLOCK finding was produced. */
  readonly blocked: boolean
}

/**
 * contaminationScan CONTENT_FILE PROJECT_NAME [LOGICAL_PATH]
 *
 * CONTENT_FILE is the bytes to scan (in a2bp the STAGED temp copy);
 * LOGICAL_PATH is the managed path those bytes will land at, kept separate
 * because the staged copy is an extensionless mktemp name and the prose/script
 * split keys off the extension (Codex F2). Defaults to CONTENT_FILE. The shell's
 * fourth argument (ALIGN_FILE) was accepted and ignored since R4-F2 removed the
 * exemption it carried; it is gone here.
 *
 * BLOCKING vs NOTICE, calibrated over all managed files when written:
 *   host path        BLOCK   — the same regex the pre-push settings guard uses
 *   foreign dot dir  BLOCK   — the BUG-002 / A-09 shape
 *   residual name    BLOCK   — the load-bearing check: any line the operator
 *                              EDITED keeps its literal project name
 *   email            NOTICE  — the ambiguous hit was legitimate; a check that
 *                              blocks a legitimate line trains the reflex to
 *                              override
 *
 * The cost is real and deliberate: a project whose name is a common word
 * blocks on its own generic prose and needs an explicit `a2bp-allow`. That is
 * the price of not having a laundering path.
 */
export function contaminationScan(f: string, projName: string, logical: string = f): ScanResult {
  const findings: string[] = []
  let blocked = false

  // `acme-flow` also appears as AcmeFlow / acme_flow / ACMEflow: any separator
  // (or none) between segments, case-insensitively. The name is escaped first —
  // a directory may legally contain regex metacharacters.
  const nameRx = projName.replace(/[\][\\.^$*+?(){}|/]/g, '\\$&').replace(/[-_]/g, '[-_]?')

  let content: string
  try {
    content = readFileSync(f, 'utf8')
  } catch {
    // The shell's `grep … 2>/dev/null || true` and `mapfile … || _lines=()`:
    // an unreadable content file scans as empty. Kept, behaviour-identical.
    content = ''
  }
  const lines = content.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()

  // Line numbers carrying a justified a2bp-allow marker. A bare marker with no
  // text after it does NOT suppress (AGENTS.md §Security: a suppression names
  // why it is safe).
  const suppressed = new Set<number>()
  lines.forEach((line, i) => {
    if (/a2bp-allow:[ \t\r\v\f]*[^ \t\r\v\f]/.test(line)) suppressed.add(i + 1)
  })

  // Markdown documents the CONVENTION; shell scripts execute a PATH. That
  // decides whether `~/.<placeholder>` is correct or is the A-09 defect.
  const isProse = logical.endsWith('.md')

  const block = (ln: number, reason: string, text: string): void => {
    findings.push(`${ln}|BLOCK|${reason}|${text}`)
    blocked = true
  }

  // One pass per pattern over all lines, as the shell ran one grep per pattern:
  // the findings of one class come before the next class's, in line order.

  // --- BLOCK: absolute host home path ---
  lines.forEach((text, i) => {
    const ln = i + 1
    if (suppressed.has(ln)) return
    if (/\/(Users|home)\/[A-Za-z0-9_.-]+\//.test(text)) {
      block(ln, 'host home path (belongs in a gitignored local config)', text)
    }
  })

  // --- BLOCK: literal per-project state dir --- (one finding per match)
  // A brace is admitted only as a WHOLE `{{WORD}}` placeholder (BUG-155): the
  // closing `}` of a shell default `${X:-$HOME/.codex}` is not part of the
  // name, so `codex` is looked up as `codex`, while `~/.<placeholder>` stays
  // visible to the prose/script split below.
  lines.forEach((line, i) => {
    const ln = i + 1
    if (suppressed.has(ln)) return
    for (const m of line.matchAll(/(\$HOME|~)\/\.(\{\{[A-Za-z0-9_]+\}\}|[A-Za-z0-9_][A-Za-z0-9_.-]*)/g)) {
      const text = m[0]
      const name = text.slice(text.indexOf('/.') + 2).split('/')[0] ?? ''
      if (KNOWN_DOTDIRS.has(name)) continue
      // `~/.<placeholder>` is already genericised. In prose that is the correct
      // way to document a per-project dir (agent_state_dir derives
      // `~/.<repo-basename>`, which in a derived project IS the project name).
      // In a SCRIPT the same string is a literal unsubstituted path — A-09.
      if (isProse && name.startsWith(PLACEHOLDER.slice(0, -2))) continue
      block(ln, 'literal per-project state dir (derive it via scripts/lib/state-dir.sh)', text)
    }
  })

  // --- BLOCK: project name that survived reverse-substitution ---
  // With provenance-based reversal this is the load-bearing check: any line the
  // operator EDITED keeps its literal project name, and this is what stops it
  // reaching the blueprint. The operator resolves it by writing the placeholder.
  const nameRe = new RegExp(`(^|[^A-Za-z0-9])${nameRx}([^A-Za-z0-9]|$)`, 'i')
  lines.forEach((text, i) => {
    const ln = i + 1
    if (suppressed.has(ln)) return
    if (nameRe.test(text)) {
      block(ln, `project name survived reverse-substitution — write ${PLACEHOLDER} explicitly if it belongs`, text)
    }
  })

  // --- NOTICE: real-looking email address --- (one finding per match)
  lines.forEach((line, i) => {
    const ln = i + 1
    if (suppressed.has(ln)) return
    for (const m of line.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
      const text = m[0]
      if (isPlaceholderEmail(text)) continue
      findings.push(`${ln}|NOTICE|operator/personal email ${text} — generic files should not name an individual|${text}`)
    }
  })

  return { findings, blocked }
}
