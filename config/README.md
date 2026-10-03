# config/

Runtime configuration that the agent reads at startup. Two-file
convention per config kind:

| Pattern | Tracked? | Purpose |
|---|---|---|
| `config/<name>.example.{md,json,yaml,...}` | **committed** | Generic public template. Anyone forking the repo sees what the file should look like. Contains placeholders, never personal data. |
| `config/<name>.{md,json,yaml,...}` | **gitignored** | The founder's real configuration. The agent reads this at runtime. Never committed. |

Examples a project might use:

- `config/positioning.md` — the founder's professional positioning
  (LinkedIn-watcher style); `config/positioning.example.md` is the
  template a reader fills in.
- `config/watchlist.json` — the founder's curated watchlist;
  `config/watchlist.example.json` shows the JSON shape.
- `config/customers.json` — internal customer list;
  `config/customers.example.json` shows the schema.

## Why this convention

1. **Public-publishability.** The committed `*.example.*` template
   means a forker / contributor can run the project. The gitignored
   real file keeps the founder's actual content out of git history.
2. **Self-documenting.** `git status --ignored` shows exactly which
   real configs exist; the `.example` siblings document the schema.
3. **Composes with `docs/PUBLISHING.md`.** The PUBLISHING runbook §1b
   preflight grep is extended per project to include each new
   `config/*.{md,json,...}` private path; the §3a allowlist export
   ships the `.example` siblings.

## Adding a new config kind

1. Add the new path to the project's `.gitignore` extension block:

   ```
   config/<name>.<ext>
   ```

2. Add the new path to `docs/PUBLISHING.md` §1b preflight grep AND
   §3b untrack command (same commit — drift is the recurring failure
   mode).

3. Write `config/<name>.example.<ext>` with the schema or template
   content. Commit it.

4. Create the real `config/<name>.<ext>` on your machine (do not
   commit). Run `git status --ignored` to confirm it shows as
   ignored.
