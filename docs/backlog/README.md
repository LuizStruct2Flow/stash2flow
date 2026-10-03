# `backlog/` — parked items

This folder is **not** active work. Items here are features, polish,
reliability rows, deferred bugs, and strategic plans that exist with full
context but are not being implemented this session or the next.

Items in `backlog/` are categorised by their re-open posture:

- **KEEP** — will be pulled when prioritised. The work is wanted; only
  sequencing keeps it parked.
- **DEFER** — re-open trigger documented in the row itself ("revisit when
  X ships" / "first customer asks for Y" / "after Phase N is mature"). The
  agent watches for the trigger.
- **OBSOLETE** — kept for audit trail before the next grooming pass deletes
  the row. Use sparingly; once a decision is captured in `docs/config/findings.md`
  the row can usually just be removed.

## Lifecycle

```
docs/
├── backlog/              ← PARKED (you are here)
├── doing/                ← active work
├── waiting-acceptance/   ← pushed, awaiting founder acceptance
└── done/                 ← user-accepted history
```

Items leave `backlog/` only by:

1. **Promotion** — move the relevant `PLAN-*.md` file (or the row in
   `BACKLOG.md`, or the multi-file folder) into `doing/`. The grooming pass
   (see "What triggers a grooming pass" below) is the typical promotion path.
2. **Cancellation** — delete the row; leave a one-line pointer in
   `docs/config/findings.md` so the audit trail survives.

`backlog/` is **never** a route to `done/`. Anything that ships passes
through `doing/` and `waiting-acceptance/` first.

## What lives here

The blueprint ships two empty stub files; add to them as items accumulate.
Multi-file plans get their own folder (`BUG-XXX-<slug>/`, `FEATURE-NN-<NAME>/`,
`PLAN-<TOPIC>/`) under `backlog/`.

| File | Purpose |
|---|---|
| `BACKLOG.md` | Parked feature / polish / reliability / strategy rows. One row per item; columns suggest category + re-open trigger. |
| `BUGS.md` | Parked bugs that keep a bug identity but aren't active. Each row carries the reproduction or trigger that re-opens it. |
| `feature-requests.md` | Blueprint only. Requests filed from derived projects that are not yet a file change (a file change goes through `blueprint a2bp`). Identified by `FR-<project>-<slug>` codes, not item numbers; the owner assigns a number on promotion. |
| `PLAN-*.md` | Full plans for parked work, with root-cause analysis, fix approach, tests needed, rollback strategy — same format as `doing/PLAN-*.md`, just frozen. |
| `<MULTI-FILE-EPIC>/` | Folder for a parked epic with multiple artefacts (plan + mockups + Codex review + research notes). Whole folder travels into `doing/` when promoted. |

## What triggers a grooming pass

The founder triggers grooming — not the agent. Typical cadence: when
`doing/` empties out, when a strategic pivot happens, or every couple of
weeks during normal flow. The grooming pass produces a
`PLAN-BACKLOG-GROOMING-YYYY-MM-DD.md` (in `doing/` while in progress, then
travels through the lifecycle like any other plan) that documents which
rows got promoted, deferred, or marked OBSOLETE.

## Index discipline

When adding a new file or multi-file folder to this directory, update the
table above (in this README) in the same commit. The index is the founder's
fast-scan entry point — drift here breaks the grooming pass.
