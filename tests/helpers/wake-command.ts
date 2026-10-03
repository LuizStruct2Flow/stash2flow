// tests/helpers/wake-command.ts — TASK-083.
//
// Several specs extract a launcher's AGENT_WAKE_COMMAND body verbatim and
// execute it under a fake provider binary (dispatch-identity,
// codex-dispatch-status). An unmigrated launcher assigns the body to a shell
// `export AGENT_WAKE_COMMAND='...'`; a migrated one (scripts/*.mts, TASK-067)
// assigns the SAME text to a JS `const AGENT_WAKE_COMMAND = `...`` template
// literal instead — and because that literal must escape every shell
// `${...}` parameter expansion as `\${...}` (a bare `${` would be a REAL JS
// interpolation, not shell text), the raw .mts source carries stray
// backslashes the shell version never had. Node's own template-literal
// evaluation strips them at runtime (the actual dispatch is correct); this
// helper does the same normalisation for a spec that reads the SOURCE BYTES
// instead of importing and running the module, so the extracted body is
// byte-identical either way before a test bash-executes it.
// unescapeTsShellText — undoes the two JS-source-only escapes a migrated
// launcher's `.mts` needs inside its AGENT_WAKE_COMMAND template literal: a
// bare `${` would be a REAL JS interpolation (not shell text), so it is
// written `\${`; a shell line-continuation backslash at end-of-line is
// likewise written `\\` (JS needs a literal backslash escaped too). Every
// static check that greps a launcher's raw bytes for a literal shell snippet
// — `"${AGENT_SIGNAL_HOLDER:-}"`, a `\` line continuation — has to see that
// snippet exactly as the shell file always had it, or the check reports a
// false regression on every successful whole-file port. `\\([\\$])` matches
// each escape pair non-overlapping and keeps only its second character, so
// `\\` -> `\` and `\$` -> `$` in one left-to-right pass. Only call this for a
// `.mts` source: the original shell files legitimately use a bare `\$` a
// couple of times (an awk field reference, a literal `$VAR` in an error
// message meant never to expand), and this would corrupt those.
export function unescapeTsShellText(source: string): string {
  return source.replace(/\\([\\$])/g, '$1')
}

export function extractWakeCommand(source: string): string | undefined {
  const shellShape = source.match(/export AGENT_WAKE_COMMAND='\n([\s\S]*?)\n'\n\nexec /)?.[1]
  if (shellShape !== undefined) return shellShape
  const tsShape = source.match(/const AGENT_WAKE_COMMAND = `\n([\s\S]*?)\n`\n/)?.[1]
  if (tsShape === undefined) return undefined
  // The wake BODY itself never legitimately needs a literal `\$` (it lived
  // inside a single-quoted shell string before the port, which needs none),
  // so unescaping it unconditionally is safe — unlike the whole-file case
  // unescapeTsShellText documents.
  return unescapeTsShellText(tsShape)
}
