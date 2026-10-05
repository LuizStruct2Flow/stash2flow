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

**Nothing has been pushed.** Every commit on `main` is local. The remote is a
public repository, so before the first push grep the tracked files for the
founder's account data (names, addresses, folder and machine names) and confirm
`docs/SPEC-*.md` is ignored.

**The concept is waiting on the founder, not on an agent.** It lives in
`docs/concept/`, one document per concern, linked by hashtags; the plan
`PLAN-FEATURE-001-media-index.md` holds only the slices. Everything he still
has to rule on is in `docs/concept/open-questions.md`.

- **The founder reads by hashtag, never by code.** Do not reintroduce numbered
  decisions, glossary codes or line references in anything he reads.
- **Nobody has reviewed the concept documents.** The PO and three architects
  reviewed the earlier single plan. The split into documents, and the rewrite
  for local copies that came with it, have had no review yet.

Every concept has an agreed word now, so slice 0 (feature files) is no longer
waiting for names. It still waits for the rulings in `open-questions.md` that
change what the index does.

**The frontend item is not planned.** Its open questions (how a frontier model
may help with the taxonomy, how an asset gets its context, which part the index
builds) must be settled before slice 6 of the index is built.

**Three rules for anything the founder reads**, learned the hard way: link
every domain word to its definition, at its first mention in each paragraph;
state a thing and never say who decided it, when, or what it replaced; never
coin a word.

**`AGENT_SIGNAL.md` carries an uncommitted fix** to the mic-watcher recipe, filed
to the blueprint as pull request 86. Leave it uncommitted; it resolves when the
founder merges and this project pulls. `blueprint drift` reports it until then.

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
