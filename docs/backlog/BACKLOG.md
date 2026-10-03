# Backlog — parked features, polish, reliability, strategy

See [README.md](README.md) for the lifecycle and categories (KEEP / DEFER /
OBSOLETE). One row per parked item; multi-file plans get their own folder
in this directory and a one-line pointer here.

**One table, not one per source.** Parked audit findings do not get a second
table with its own column schema — that makes "what is parked?" two questions
instead of one. They are rows like any other; where an item came from belongs in
its text, not in its own table.

| # | Item | Sev | Category | Re-open trigger / next-step gate |
|---|---|---|---|---|

**A promoted row leaves nothing behind.** The whole row moves into
`docs/doing/`; no stub, no forwarding note. A row left behind after a promotion
is a duplicate record, and a forwarding note is the same thing one size smaller
— it goes stale the moment the item moves again.
