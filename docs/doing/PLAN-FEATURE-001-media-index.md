# Plan: [FEATURE-001](BACKLOG.md) media index

This is the delivery plan of the index: the slices it is built in, what is
deliberately left out, and which project configuration it fills. It holds no
concept. What the app is, its words, its rules and its architecture are in the
concept documents; start at [docs/concept/README.md](../concept/README.md).

**Status:** no code yet. The plan waits for the founder's rulings in
[open-questions.md](../concept/open-questions.md). Slice 0 cannot start before
the [words still to name](../concept/domain-language.md#words-still-to-name)
are named, because the feature files must use his words.

**The repository is public:** see
[#public-repository](../concept/principles.md#public-repository).

## Slices

`#slices`

Each slice ends in something the founder can run. A slice is done when its
scenarios are green; why specifications come before code is
[#specifications-first](../concept/testing.md#specifications-first).

The column "Goes green" is a summary. The list that says which scenario
belongs to which slice is
[#draft-scenario-titles](../concept/testing.md#draft-scenario-titles): the
scenarios marked with the slice's number.

| # | Delivers (what the founder can do) | Goes green | Adds |
|---|---|---|---|
| 0 | **Read and approve the words and all feature files.** No production code. | None. All scenarios are counted as pending: [#what-slice-0-proves](../concept/testing.md#what-slice-0-proves). | The agreed words into the project configuration; `backend/package.json` with the gate's four scripts; `backend/features/` with a skeleton for every step, and the [#pending-check](../concept/testing.md#pending-check) with its own test. |
| 1 | **Pick the OCR engine and see that TypeScript carries the load**, on made-up and real files, on the server and on a Mac. He sees one table: OCR quality per candidate on a sample of real scans; a made-up HEIC decoded on Linux and on the Mac giving the same phash, and within the near threshold of its JPG copy; files per hour for the chosen OCR and for both embeddings, extended to 100,000 files. | None. | `backend/spikes/`; the lint of the [#dependency-rule](../concept/architecture.md#dependency-rule) with its rejected examples; the project's own CI workflow with PostgreSQL ([#continuous-integration](../concept/testing.md#continuous-integration)); the check for the public repository ([#question-public-repository-check](../concept/open-questions.md#question-public-repository-check)). |
| 2 | **First search.** `stash search "<words printed on a scan>"` over one Google Drive account, after a full run. | Search by OCR text, accents and misreadings; starting a run; local copies; the first pipeline steps; the API refusing a call without credentials; local models only. | Ports for reading a source, for what a run talks to (file records only), index, OCR, file reading, the store of local copies, token store, clock. Adapters: Google Drive, PostgreSQL, OCR, the API with authentication, the command line. All hashes, metadata and the thumbnail are made from this slice on. The baseline's file and byte counts start here, with the first full run. |
| 3 | **Second run costs nothing.** Run again: nothing downloaded. Interrupt and resume. Remove a file and see it kept, marked as vanished. See a run's state and errors. | Resuming, unchanged and changed files, vanished files, run errors. | Cursor, checkpoint, the unchanged rule, vanished files and run records ([#unchanged-files](../concept/how-it-works.md#unchanged-files)); the record of which pipeline steps a file has completed. |
| 4 | **All server file sources.** Every OneDrive and Google Drive account searchable; videos indexed. | Videos. | Adapter: OneDrive. Further accounts by configuration. |
| 5 | **E-mail.** The first e-mail run lists the senders with counts and hints; he sorts them into whitelist and blacklist; the next run makes the whitelisted senders' attachments searchable, and their bodies if so ruled. It comes early because official receipts often exist only as attachments. | All e-mail scenarios. | Adapter: Gmail, reporting the sender and the provider's hints per e-mail. Whitelist and blacklist, stored in the database, kept through the command line ([#senders-decide](../concept/sources.md#senders-decide)). The baseline's count of blacklisted messages. |
| 6 | **Descriptions and filters.** `stash search --doc-type tax --person <name> --from 2005 --to 2015`; each document shows its one-line description. Files already indexed get their description on request. | Description, doc_type, kind; search filters; a step run over existing files. | Port and adapter: description, at the local model server. Processing existing files for a step on request ([#steps-added-later](../concept/how-it-works.md#steps-added-later)). |
| 7 | **Search across languages.** English words find a Portuguese receipt. | The cross-language search scenario. | Port and adapter: text embedding; pgvector. |
| 8 | **Duplicates.** `stash dups --report` opens the page with thumbnails, keepers suggested from his order of sources, shared-account files flagged. He changes a keeper and marks a group reviewed there. | All duplicate scenarios but the one that needs a Mac. | Grouping; the order of sources (kept with each source, set through the command line); the report page with its two changes, authentication and stored choices; a group keeps its id when files join it ([#choosing-the-keeper](../concept/how-it-works.md#choosing-the-keeper)). The baseline's duplicate share. |
| 9 | **Mac collector.** iCloud Drive and iCloud Photos from a Mac; the collector uploads the bytes of every file it reports. | Collectors; a full run over all sources; the JPG and HEIC near group; what is kept from iCloud Photos. | The collector's entry point. Adapters: iCloud Drive, iCloud Photos, and the API client for what a run talks to; uploads on the API ([#mac-collector](../concept/sources.md#mac-collector)). |
| 10 | **Photos.** `stash photos --date 2024-07`, `--query "beach"`. Photos already indexed get their embedding on request, from their local copies. | Finding photos by month and by what they show. | Port and adapter: image embedding, for photos and query text. |
| 11 | **Stays current.** A run starts by itself 30 days after the source's last finished run, on the server and through `launchd` on the Mac; summary notification. | The 30-day scenarios; the summary notification. | The scheduler's entry point, the `launchd` agent, the notification adapter ([#thirty-days](../concept/how-it-works.md#thirty-days)). |

Two things must be true before a slice starts:

- before slice 2: the server's disk is encrypted
  ([#disk-encryption](../concept/infrastructure.md#disk-encryption));
- before slice 6: the taxonomy question of the frontend is ruled
  ([#question-taxonomy-step](../concept/open-questions.md#question-taxonomy-step)).

## Not in this item

`#not-in-this-item`

Named so nobody builds them by accident:

- Searching photos by place, and turning coordinates into place names. So the
  goal "find photos by place" is **not met by this item**: place is stored, not
  searchable.
- Hosted models ([#local-models-only](../concept/principles.md#local-models-only)).
- A server that lets a chat assistant query the index.
- A graph extension for the database.
- Mailboxes other than Gmail, read over IMAP.
- Moving non-keepers into a review folder
  ([#question-moving-non-keepers](../concept/open-questions.md#question-moving-non-keepers)).
- Enabling a second Mac's collector: configuration only, when needed.
- The frontend, [FEATURE-003](BACKLOG.md).
- The clean copy, [FEATURE-004](../backlog/BACKLOG.md).
- Cleaning up unnecessary content, [FEATURE-002](../backlog/BACKLOG.md).

## Config this item will fill

`#config-this-item-will-fill`

A list only; nothing is edited yet.

| File | Section | What goes in |
|---|---|---|
| `project_config_overview.md` | Core USP paths | Search (find a document by its text), runs (nothing lost, nothing done twice), duplicates never deleted, privacy |
| | Tech stack | TypeScript, PostgreSQL, local models; each of the [#deviations-from-the-stack-defaults](../concept/architecture.md#deviations-from-the-stack-defaults) with its sentence |
| | Observability stack | The local recipe: [#logs](../concept/infrastructure.md#logs) |
| | Cost stack | No billable path: all models local, provider APIs free and read-only |
| | Documentation stack | Recipe A (README only) |
| | Domain glossary | The words of [domain-language.md](../concept/domain-language.md) |
| `project_config_paths.md` | Repository layout; `BP_TEST_ROOTS` | `backend/`, `infra/`; `BP_TEST_ROOTS: backend/src` ([#directory-layout](../concept/architecture.md#directory-layout)) |
| | `BP_CI` | `github-actions`, plus the project's own workflow |
| | External integrations | Microsoft Graph, Google Drive API, Gmail API |
| `project_config_dod.md` | Pre-push gate commands | The shipped npm stages; `test:coverage` also runs the specifications and the pending check |
| | Coverage mode | Greenfield, at least 90% on domain and application |
| | Test architecture | [#pinned-stages](../concept/testing.md#pinned-stages) and [#fixtures](../concept/testing.md#fixtures) |
| | Project-specific quality gates | "Specifications before code", and a feature file's wording changes only with the founder's review |
| `project_config_security.md` | Recipe, trust boundaries, auth | A local service on the local network. Collector, command line and browser to the API: token, HTTPS. Server to provider APIs: OAuth, read-only scopes, tokens encrypted. Server to the local model server: local address only. |
| | Sensitive data classes; adversary assumptions | [#sensitive-data](../concept/infrastructure.md#sensitive-data) |
| `project_config_infra.md` | Recipe, environments, rollback | One server, no cloud accounts; [#server-setup](../concept/infrastructure.md#server-setup); backup and restore ([#backup](../concept/infrastructure.md#backup)) |
