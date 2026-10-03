# BUG-017 — does not reproduce at HEAD. Closed OBSOLETE with evidence.

**Reported** (PR #4, from `linkedin-watcher-agent`): *"`pull`'s confirmation
diff is rendered BEFORE substitution, showing `{{PROJECT_NAME}}` being written
into the project. The diff you approve is not the content that lands."*

**Verified 2026-08-03: it does not happen at HEAD.**

## What was measured

A fixture blueprint with a placeholder-bearing managed file, a derived project
behind it, and `blueprint pull docs/DoD.md` run against the current CLI. The
rendered diff was searched for the raw token:

```
=== BUG-017 probe: does the shown diff contain the RAW placeholder? ===
does NOT reproduce at HEAD: the diff is already substituted
```

The relevant code renders against `bp_cmp_pull`, which is
`substituted_blueprint_copy "$bp"` — the blueprint file with `{{PROJECT_NAME}}`
already replaced. The comment above it states that intent, and the behaviour
matches it.

## Why it was reported anyway, and why that matters more than the bug

The reporting project was running a `scripts/blueprint` **18 commits behind**,
and could not know it — because that is **BUG-013**: `drift` told every derived
project *"This IS the blueprint"* and reported zero drift, so a stale CLI looked
current. The report is an accurate observation of the code that project was
actually executing.

So this is not a bad report. It is a **second-order symptom of BUG-013**, and it
is the more useful half of the finding: a stale CLI does not merely miss new
features, it makes an agent file bugs against code the blueprint no longer has,
and those reports cost review time on both sides.

Two things follow, both already done:

- BUG-013 is fixed (PR #5) — `.blueprint-root` is a positive marker that cannot
  reach a derived project, so a stale CLI can no longer masquerade as current.
- **A defect reported from a derived project must be reproduced against
  blueprint HEAD before it is worked**, not because reporters are unreliable but
  because "which code was actually running?" is a question a derived project has
  historically been unable to answer for itself.

## Disposition

`OBSOLETE`. Not fixed, because there is nothing to fix. Recorded here rather
than deleted so the next person who reads PR #4 and goes looking for the defect
finds this instead of re-deriving the same probe.

Reproduce the check any time with `.scratch/probe-pull.sh`.
