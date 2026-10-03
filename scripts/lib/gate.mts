// scripts/lib/gate.mts — TASK-067 / BUG-152 port of the shell library gate.sh,
// which TASK-088 deleted.
//
// One CLI, one subcommand per function of the original shell library. Its
// callers (scripts/agent-activity.sh, scripts/blueprint.mts) run
// `node scripts/lib/gate.mts <subcommand>` directly.
//
// WHY THIS EXISTS — see the original gate.sh history for the full
// policy rationale (BUG-004, BUG-077, BUG-032). This file's job is to preserve
// that policy byte-for-byte — every echo line is exactly the shell's, because
// both callers (scripts/agent-activity.sh, scripts/blueprint.mts) inherit stdout
// and the wake report is built from these bytes — while moving it off shell;
// it is not the place to relitigate any of those decisions.
//
// THE BUG-152 FIX (an absolute core.hooksPath that resolves to this repo's own
// .githooks reads as armed) landed one commit after the port, per the port
// method: port first (behaviour-identical, proven three ways), then the fix.
//
// Usage errors and internal failures exit >1 (2), never 1 — the same
// convention scripts/lib/dod-gate.mts carries.

import { execFileSync } from 'node:child_process'
import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

// gitConfig — `git -C root config …` with the shell's error posture: stdout
// captured, stderr dropped, ANY non-zero exit (unset key, unreadable repo)
// read as undefined. The shell's `$(… 2>/dev/null || true)` made no
// distinction, and neither may we.
function gitConfig(root: string, args: readonly string[]): string | undefined {
  try {
    const out = execFileSync('git', ['-C', root, 'config', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    // Command substitution strips trailing newlines, never interior ones.
    return out.replace(/\n+$/, '')
  } catch {
    // The shell's `$(… 2>/dev/null || true)`: an unset key or an unreadable
    // repo is the probed state, which undefined reports to the caller.
    return undefined
  }
}

// gitConfigSet — the `config --local` WRITE both functions make. Success is
// the exit status alone; the shell swallowed stderr and branched on status,
// so a throw here IS the failure branch, never a reason to propagate.
function gitConfigSet(root: string, key: string, value: string): boolean {
  try {
    execFileSync('git', ['-C', root, 'config', '--local', key, value], {
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    return true
  } catch {
    // The shell swallowed stderr and branched on status alone: a throw IS
    // the failure branch the caller's if/else already handles, not a reason
    // to propagate.
    return false
  }
}

// inGitRepo — the `git rev-parse --git-dir >/dev/null 2>&1` guard: the answer
// is exit status only, the directory's own path never used.
function inGitRepo(root: string): boolean {
  try {
    execFileSync('git', ['-C', root, 'rev-parse', '--git-dir'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    return true
  } catch {
    // `rev-parse >/dev/null 2>&1` in the shell: the exit status IS the
    // answer, and a non-repo here means "stay silent and return 0".
    return false
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    // A missing path fails the same `[ -d … ]` test the shell applied; the
    // boolean is the whole result.
    return false
  }
}

// resolvesTo — both paths exist and are the same real path. A missing or
// unreadable path is "not the same", which the caller treats as foreign.
function resolvesTo(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b)
  } catch {
    // realpath throws on a missing path: nothing to resolve, so not ours.
    return false
  }
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    // `[ -x … ]` again: unreadable or absent both mean "cannot gate", which
    // the caller reports as its NOT-arming warning.
    return false
  }
}

// --- arm_gate (subcommand 'arm-gate') --------------------------------------
//
// Reports the gate state ALWAYS (founder's call: explicit, not silent) and
// arms only when core.hooksPath is UNSET. Never fails the caller — every
// path exits 0. THE ROOT IS REQUIRED (BUG-077): it is never inferred from
// the caller's git environment, which a hook can redirect.
function armGate(root: string): void {
  if (root === '') {
    process.stdout.write(
      '  ⚠ gate: arm_gate needs an explicit project root — nothing to arm.\n' +
        '     Pass the root you already resolved; it is never inferred from the\n' +
        '     git environment, which a hook can redirect (BUG-077).\n',
    )
    return
  }
  if (!isDirectory(root)) {
    process.stdout.write(`  ⚠ gate: '${root}' is not a directory — nothing to arm\n`)
    return
  }

  // Never point core.hooksPath at a directory that cannot gate.
  if (!isExecutable(join(root, '.githooks/pre-push'))) {
    process.stdout.write('  ⚠ gate: .githooks/pre-push missing or not executable — NOT arming\n')
    return
  }

  const cur = gitConfig(root, ['--get', 'core.hooksPath']) ?? ''

  if (cur === '.githooks') {
    process.stdout.write('  ✓ gate: armed (core.hooksPath=.githooks)\n')
    return
  }

  // BUG-152: a worktree-isolated launch rewrites core.hooksPath to the
  // absolute spelling of this repository's own .githooks. That is the same
  // gate, so report it armed — compared as RESOLVED real paths, never strings,
  // and only for an absolute value (a relative one is resolved by git against
  // somewhere else, so it stays foreign). The value is left alone.
  if (isAbsolute(cur) && resolvesTo(cur, join(root, '.githooks'))) {
    process.stdout.write(`  ✓ gate: armed (core.hooksPath=${cur}, this repository's own .githooks)\n`)
    return
  }

  if (cur !== '') {
    // Someone deliberately points at husky, a shared hooks dir, or a test rig.
    // Silently rewriting another tool's git config is how you lose trust — warn
    // and leave it, so the operator knows OUR gate is not the one running.
    process.stdout.write(
      `  ⚠ gate: core.hooksPath is '${cur}', not .githooks — leaving it alone.\n` +
        '     The struct2flow pre-push gate is NOT active. Run\n' +
        "     'git config --local core.hooksPath .githooks' if you want it.\n",
    )
    return
  }

  if (gitConfigSet(root, 'core.hooksPath', '.githooks')) {
    process.stdout.write('  ✓ gate: ARMED core.hooksPath=.githooks (was unset — a clone is ungated by default, BUG-004)\n')
  } else {
    process.stdout.write('  ⚠ gate: could not set core.hooksPath (read-only config?) — gate NOT active\n')
  }
}

// --- arm_push_keepalive (subcommand 'arm-push-keepalive') ------------------
//
// BUG-032: git opens the SSH connection, THEN runs pre-push, THEN transfers
// on that same connection; a gate longer than the remote's idle timeout used
// to kill the push after a green run. Same non-clobber rule as the gate: a
// deliberate core.sshCommand belongs to whoever set it. The root is REQUIRED
// for the same reason arm_gate's is (BUG-077).
function armPushKeepalive(root: string): void {
  if (root === '') return
  if (!inGitRepo(root)) return

  const cur = gitConfig(root, ['--get', 'core.sshCommand']) ?? ''
  if (cur.includes('ServerAliveInterval')) return
  if (cur !== '') {
    process.stdout.write(
      '  ⚠ push: core.sshCommand is set and carries no ServerAliveInterval —\n' +
        '     leaving it alone. A gate longer than the remote\'s idle timeout can\n' +
        '     kill the push after a green run (BUG-032).\n',
    )
    return
  }

  // 20 s is well inside every common idle timeout, and 30 missed probes before
  // giving up means a genuinely dead link still fails rather than hanging.
  if (gitConfigSet(root, 'core.sshCommand', 'ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=30')) {
    process.stdout.write('  ✓ push: keepalive armed (core.sshCommand, BUG-032)\n')
  }
  // The failed-write branch prints NOTHING — the shell's `if git …` had no
  // else, and the keepalive is the one arming whose failure stays silent.
}

function usageError(msg: string): never {
  process.stderr.write(`internal error: ${msg}\n`)
  process.exit(2)
}

function main(): void {
  const [sub, arg1] = process.argv.slice(2)
  switch (sub) {
    case 'arm-gate':
      armGate(arg1 ?? '')
      break
    case 'arm-push-keepalive':
      armPushKeepalive(arg1 ?? '')
      break
    default:
      usageError(`unknown subcommand '${sub ?? ''}' — expected one of: arm-gate, arm-push-keepalive`)
  }
  process.exit(0)
}

main()
