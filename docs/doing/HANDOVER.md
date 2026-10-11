# HANDOVER — what a waking agent needs to TAKE OVER

**Founder rule:** *this file holds only what the next agent needs to take over
something open or in-flight. Everything else belongs in the tasks/bugs, the
commits, or the md files.*

So this file is **not** a status report and **not** a history. In the blueprint
it went from 530 lines to a page because it kept narrating things that already
have a home:

| If you want to know… | Read |
|---|---|
| what is open, and what to test | the four `docs/<state>/` folders |
| what changed and why | `git log` — commit bodies carry the reasoning |
| what a fix taught | the item's own row in `done/BUGS.md` |
| the rules | `AGENTS.md`, `docs/DoD.md` |
| host quirks, standing founder decisions | `project_config_overview.md` |

**Anything derivable from a command does not belong here.** If you catch
yourself writing "N items are in `doing/`", delete it — `ls` already said so,
and it cannot go stale the way this file can.

---

## 1. START HERE

```bash
bash scripts/session-resume.sh
```

It derives the git state, the four lifecycle folders, the live baton and the
journal events since the last handoff marker. It holds nothing, so it cannot go
stale. **Exit 9** means the report is incomplete or the snapshot untrusted, and
the warning says which — do not read a short replay as a quiet one. Roll the
window at the next handoff with `--mark`; if the tree is untrusted, `--rollback`
stashes (never `checkout --`).

Two things it does NOT do, so you do not go looking:

- **It does not read the activity feed.** It reports the journal, not the feed.
- **It does not detect tampering**, only loss. Silence means nothing was lost by
  itself, not that nobody rewrote the record.

## 2. WIP — what is in flight right now

**The remote is a public repository.** The gate stage "private values" refuses a
push that carries a value from the untracked list `.private-values`. Do not
open, print or quote that list; run `node scripts/private-values-check.mts
--repo . --range origin/main..main` and read only its masked output. A local
branch named `backup-before-scrub` may exist: it holds history from before
such data was removed and must never be pushed.

**Slice 2 (the first search) is half built.** Its core is on `main`: domain,
use-cases, ports and a fake for every port, with 28 scenarios delivered. The
real adapters are NOT built: the database, the first cloud source, the command
line, the server's API, the encrypted token store, and the guardian around the
real reading libraries. 11 scenarios keep their `@slice-2` tag until they are.
The adapters need a network and a database, so they cannot go to the provider
whose sandbox has neither.

**The rotation is asked per slice, not per feature.** Use
`--item FEATURE-001-slice-N`. Asked per feature, it returns the same provider
for all eleven slices. Nothing is pushed without a review by a provider that
did not write it, and the reviewer who finds something fixes it.

**What a review must look for here:** scenarios and tests that pass whatever
the code does. Two reviews of the slice 2 core found six of them: a step that
set up the very thing its Then asserted, a counter nothing increased, a test
that observed a fake's side effect. Ask each reviewer to trace a sample of
green scenarios by hand, and ask each fixer to break the code on purpose and
see the scenario fail.

**Waiting on the founder, not on an agent:**

- The rulings still open in `docs/concept/open-questions.md`.
- Real documents on the server: see the private host quirks. Until that is
  solved, everything runs on made-up data. The comparison of OCR candidates on
  real scans waits for it too.
- A history rewrite of this repository, agreed in principle. It starts only
  when the private-values check reports no suppressed hit in the
  blueprint-managed files, and only after he has seen the plan for it.
- TASK-002 in `docs/backlog/BACKLOG.md` is parked with him; do not raise it.
  Until he rules, every brief says: download nothing except libraries declared
  in the project's package file.

**How to write for the founder**, learned the hard way: link every domain word
to its definition at its first mention in each paragraph; state a thing and
never say who decided it, when, or what it replaced; never coin a word; bring
him only decisions that change what gets built, each with the place, the
current wording and one recommendation.

## 3. Standing gotchas for this project

- **Host quirks are private.** They are in `project_config_overview.md`
  §"Host quirks", which is not in the repository. Read them before running
  anything against the server or its database.
- **The mic watcher lives 30 minutes here**, not the hour `AGENT_SIGNAL.md` says,
  and the Claude persona agent types are not registered in a session that
  started before `.claude/agents/` was written. Check with one dispatch; fall
  back to a general-purpose agent with the persona's roster model.
- **The dispatchers die with the session.** Start
  `scripts/start-codex-signal-watch.mts` and `scripts/start-kimi-signal-watch.mts`
  before flipping the mic to Codex or Kimi.
