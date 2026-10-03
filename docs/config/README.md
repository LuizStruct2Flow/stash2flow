# `config/` — stable product reference

Catalog files that evolve with the product but are not lifecycle-managed
through `doing/` → `done/`:

- `FEATURES.md` — internal feature catalog.
- `ACCEPTANCE_TESTS.md` — `AT-XXX` test rows kept in sync with features.
- `findings.md` — Codex / code-review findings being tracked over time.

Per DoD §doc-sync, user-facing feature changes propagate to the project's
in-app help page, landing page, release notes, and these catalogs in lockstep.
The exact file set is project-specific — declare it in `project_config_dod.md`.
