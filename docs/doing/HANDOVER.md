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

*(Nothing yet. Replace this with the open / in-flight work a waking agent has to
pick up: the branch, what is done, what is not, and the finding that is still
unfixed. Delete anything that a lifecycle folder or `git log` already answers.)*

## 3. Standing gotchas for this project

*(Host quirks and standing founder decisions live in
`project_config_overview.md`. Put here only what a waking agent would trip over
in the next hour.)*
