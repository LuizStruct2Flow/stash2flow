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
| **FEATURE-002** | Clean up unnecessary content: use the index to find what is not worth keeping (advertisement e-mails, non-keeper duplicates) and remove it from its source, only after explicit confirmation. Founder, 2026-10-03: "in the future I want also to use this app to clean up unnecessary content". It is the first thing that writes to a source, so it changes two rules of the media index: read-only access and "never delete automatically". Two rules it starts from (founder, 2026-10-03): for content that is deduplicated, the founder chooses the source that wins; and no content is deleted without his go. It is the last step of the founder's goal (2026-10-03): once everything is organized, he cleans all his cloud drives and keeps one clean copy. So a third rule: a file is removed from a source only when its bytes are verified, by hash, both on the server and in the clean copy. | S3 | DEFER | The clean copy exists and has been verified against the server's copies. |
| **FEATURE-004** | Clean copy: write everything the index holds, organized in the clean structure of the taxonomy, to one place the user chooses (for the founder, iCloud), and keep it current. Founder, 2026-10-03: "after a while my documents and everything is so organized in a clean structure and taxonomy, that I can revert it, clean all my cloud drives and keep a clean copy of this database in icloud for instance". Open before planning: whether the clean copy is plain folders and files that can be read without the app, or the app's own store. | S3 | DEFER | The frontend ([FEATURE-003](../doing/BACKLOG.md)) is accepted and the taxonomy has been used on the real content. |
| **FEATURE-005** | Organizations: use the app to organize the information of an organization, not only of one person. Founder, 2026-10-04: "this app could help to organize also information in organizations, it could replace confluence, but step by step". It needs what the app does not have today: several users, who may see what, and information that people write in the app and not only assets that are collected. | S3 | DEFER | The frontend ([FEATURE-003](../doing/BACKLOG.md)) is accepted and the founder uses the app for his own assets every month. |

**A promoted row leaves nothing behind.** The whole row moves into
`docs/doing/`; no stub, no forwarding note. A row left behind after a promotion
is a duplicate record, and a forwarding note is the same thing one size smaller
— it goes stale the moment the item moves again.
