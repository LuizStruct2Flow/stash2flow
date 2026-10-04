# Plan: [FEATURE-001](BACKLOG.md) media index

This is the delivery plan of the index: the slices it is built in, what is
deliberately left out, and which project configuration it fills. It holds no
concept. What the app is, its words, its rules and its architecture are in the
concept documents; start at [docs/concept/README.md](../concept/README.md).

**Status:** no code yet. The plan waits for the founder's rulings in
[open-questions.md](../concept/open-questions.md).

**The repository is public:** see
[public repository](../concept/principles.md#public-repository).

## Slices

`#slices`

Each slice ends in something the founder can run. A slice is done when its
scenarios are green; why specifications come before code is
[specifications first](../concept/testing.md#specifications-first).

The column "Goes green" is a summary. The list that says which scenario
belongs to which slice is
[draft scenario titles](../concept/testing.md#draft-scenario-titles): the
scenarios marked with the slice's number.

| # | Delivers (what the founder can do) | Goes green | Adds |
|---|---|---|---|
| 0 | **Read and approve the words and all feature files.** No production code. | None. All scenarios are counted as pending: [what slice 0 proves](../concept/testing.md#what-slice-0-proves). | The agreed words into the project configuration; `backend/package.json` with the gate's four scripts; `backend/features/` with a skeleton for every step, and the [pending check](../concept/testing.md#pending-check) with its own test. |
| 1 | **Pick the OCR engine and see that TypeScript carries the load**, on made-up and real files, on the [server](../concept/domain-language.md#server) and on a Mac. He sees one table: OCR quality per candidate on a sample of real [scans](../concept/domain-language.md#scan); a made-up HEIC decoded on Linux and on the Mac giving the same [phash](../concept/domain-language.md#phash), and within the [near](../concept/domain-language.md#near) threshold of its JPG copy; files per hour for the chosen OCR and for both [embeddings](../concept/domain-language.md#embedding), extended to 100,000 files. | None. | `backend/spikes/`; the lint of the [dependency rule](../concept/architecture.md#dependency-rule) with its rejected examples; the project's own CI workflow with PostgreSQL ([continuous integration](../concept/testing.md#continuous-integration)); the check for the public repository ([open question: public repository check](../concept/open-questions.md#question-public-repository-check)). |
| 2 | **First search.** `stash search "<words printed on a scan>"` over one Google Drive [account](../concept/domain-language.md#account), after a full [run](../concept/domain-language.md#run). | Search by [OCR text](../concept/domain-language.md#ocr-text), accents and misreadings; starting a run; [local copies](../concept/domain-language.md#local-copy); the first [pipeline](../concept/domain-language.md#pipeline) steps; the [API](../concept/domain-language.md#api) refusing a call without credentials; local models only. | Ports for [fetching](../concept/domain-language.md#fetching) a [source](../concept/domain-language.md#source), the [ledger](../concept/domain-language.md#ledger) ([asset records](../concept/domain-language.md#asset-record) only), index, OCR, file reading, the [stash](../concept/domain-language.md#stash), token store, clock. Adapters: Google Drive, PostgreSQL, OCR, the API with authentication, the command line. All hashes, metadata and the thumbnail are made from this slice on. The [baseline](../concept/domain-language.md#baseline)'s [asset](../concept/domain-language.md#asset) and byte counts start here, with the first full run. |
| 3 | **Second [run](../concept/domain-language.md#run) costs nothing.** Run again: nothing downloaded. Interrupt and resume. Remove an [asset](../concept/domain-language.md#asset) and see it kept, marked as [vanished](../concept/domain-language.md#vanished). See a run's state and errors. | Resuming, unchanged and changed assets, vanished assets, run errors. | [Cursor](../concept/domain-language.md#cursor), [checkpoint](../concept/domain-language.md#checkpoint), the unchanged rule, vanished assets and run records ([unchanged assets](../concept/how-it-works.md#unchanged-assets)); the record of each asset's [completed steps](../concept/domain-language.md#completed-steps). |
| 4 | **All [server](../concept/domain-language.md#server) file [sources](../concept/domain-language.md#source).** Every OneDrive and Google Drive [account](../concept/domain-language.md#account) searchable; videos indexed. | Videos. | Adapter: OneDrive. Further accounts by configuration. |
| 5 | **[E-mail](../concept/domain-language.md#e-mail).** The first e-mail [run](../concept/domain-language.md#run) lists the [senders](../concept/domain-language.md#sender) with counts and hints; he sorts them into [whitelist](../concept/domain-language.md#whitelist) and [blacklist](../concept/domain-language.md#blacklist); the next run makes the whitelisted senders' [attachments](../concept/domain-language.md#attachment) searchable, and their bodies if so ruled. It comes early because official receipts often exist only as attachments. | All e-mail scenarios. | Adapter: Gmail, reporting the sender and the [provider](../concept/domain-language.md#provider)'s hints per e-mail. Whitelist and blacklist, stored in the database, kept through the command line ([senders decide](../concept/sources.md#senders-decide)). The [baseline](../concept/domain-language.md#baseline)'s count of blacklisted messages. |
| 6 | **[Descriptions](../concept/domain-language.md#description) and filters.** `stash search --doc-type tax --person <name> --from 2005 --to 2015`; each document shows its one-line description. [Assets](../concept/domain-language.md#asset) already indexed get their description on request. | Description, [doc_type](../concept/domain-language.md#doc_type), [persons](../concept/domain-language.md#person) (several per asset), [kind](../concept/domain-language.md#kind); search filters; a step run over existing assets. | Port and adapter: description, at the local model server. Processing existing assets for a step on request ([steps added later](../concept/how-it-works.md#steps-added-later)). |
| 7 | **Search across languages.** English words find a Portuguese receipt. | The cross-language search scenario. | Port and adapter: text [embedding](../concept/domain-language.md#embedding); pgvector. |
| 8 | **[Duplicates](../concept/domain-language.md#duplicate).** `stash dups --report` opens the page with thumbnails, [keepers](../concept/domain-language.md#keeper) suggested from his [order of sources](../concept/domain-language.md#order-of-sources), [shared-account](../concept/domain-language.md#shared-account) assets flagged. He changes a keeper and marks a group [reviewed](../concept/domain-language.md#reviewed) there. | All duplicate scenarios but the one that needs a Mac. | Grouping; the order of sources (kept with each [source](../concept/domain-language.md#source), set through the command line); the report page with its two changes, authentication and stored choices; a group keeps its id when [assets](../concept/domain-language.md#asset) join it ([choosing the keeper](../concept/how-it-works.md#choosing-the-keeper)). The [baseline](../concept/domain-language.md#baseline)'s duplicate share. |
| 9 | **Mac [collector](../concept/domain-language.md#collector).** iCloud Drive and iCloud Photos from a Mac; the collector uploads the [bytes](../concept/domain-language.md#bytes) of every [asset](../concept/domain-language.md#asset) it reports. | Collectors; a full [run](../concept/domain-language.md#run) over all [sources](../concept/domain-language.md#source); the JPG and HEIC [near](../concept/domain-language.md#near) group; what is kept from iCloud Photos. | The collector's entry point. Adapters: iCloud Drive, iCloud Photos, and the [API](../concept/domain-language.md#api) client for the [ledger](../concept/domain-language.md#ledger); uploads on the API ([the Mac collector](../concept/sources.md#mac-collector)). |
| 10 | **Photos.** `stash photos --date 2024-07`, `--query "beach"`. Photos already indexed get their [embedding](../concept/domain-language.md#embedding) on request, from their [local copies](../concept/domain-language.md#local-copy). | Finding photos by month and by what they show. | Port and adapter: image embedding, for photos and query text. |
| 11 | **Stays current.** A [run](../concept/domain-language.md#run) starts by itself 30 days after the [source](../concept/domain-language.md#source)'s last finished run, on the [server](../concept/domain-language.md#server) and through `launchd` on the Mac; [summary notification](../concept/domain-language.md#summary-notification). | The 30-day scenarios; the summary notification. | The [scheduler](../concept/domain-language.md#scheduler)'s entry point, the `launchd` agent, the notification adapter ([thirty days](../concept/how-it-works.md#thirty-days)). |

Two things must be true before a slice starts:

- before slice 2: the [server](../concept/domain-language.md#server)'s disk is
  encrypted ([disk encryption](../concept/infrastructure.md#disk-encryption));
- before slice 6: it is ruled what the index builds and what the frontend builds
  ([open question: which step builds what](../concept/open-questions.md#question-which-step-builds-what)).

## Not in this item

`#not-in-this-item`

Named so nobody builds them by accident:

- Searching photos by [place](../concept/domain-language.md#place), and turning
  coordinates into place names. So the goal "find photos by place" is **not met
  by this item**: place is stored, not searchable.
- Hosted models ([local models only](../concept/principles.md#local-models-only)).
- A server that lets a chat assistant query the index.
- A graph extension for the database.
- Mailboxes other than Gmail, read over IMAP.
- Moving [non-keepers](../concept/domain-language.md#non-keeper) into a review
  folder
  ([open question: moving non-keepers](../concept/open-questions.md#question-moving-non-keepers)).
- Enabling a second Mac's [collector](../concept/domain-language.md#collector):
  configuration only, when needed.
- The frontend, [FEATURE-003](BACKLOG.md), and with it the
  [taxonomy](../concept/domain-language.md#taxonomy), the
  [contexts](../concept/domain-language.md#context), the
  [tags](../concept/domain-language.md#tag) the
  [user](../concept/domain-language.md#user) makes, and browsing
  ([how assets are organized and found](../concept/how-it-works.md#how-assets-are-organized-and-found)).
- The clean copy, [FEATURE-004](../backlog/BACKLOG.md).
- Cleaning up unnecessary content, [FEATURE-002](../backlog/BACKLOG.md).

## Config this item will fill

`#config-this-item-will-fill`

A list only; nothing is edited yet.

| File | Section | What goes in |
|---|---|---|
| `project_config_overview.md` | Core USP paths | Search (find a document by its text), [runs](../concept/domain-language.md#run) (nothing lost, nothing done twice), [duplicates](../concept/domain-language.md#duplicate) never deleted, privacy |
| | Tech stack | TypeScript, PostgreSQL, local models; each of the [deviations from the stack defaults](../concept/architecture.md#deviations-from-the-stack-defaults) with its sentence |
| | Observability stack | The local recipe: [logs](../concept/infrastructure.md#logs) |
| | Cost stack | No billable path: all models local, [provider](../concept/domain-language.md#provider) APIs free and read-only |
| | Documentation stack | Recipe A (README only) |
| | Domain glossary | The words of [domain-language.md](../concept/domain-language.md) |
| `project_config_paths.md` | Repository layout; `BP_TEST_ROOTS` | `backend/`, `infra/`; `BP_TEST_ROOTS: backend/src` ([directory layout](../concept/architecture.md#directory-layout)) |
| | `BP_CI` | `github-actions`, plus the project's own workflow |
| | External integrations | Microsoft Graph, Google Drive API, Gmail API |
| `project_config_dod.md` | Pre-push gate commands | The shipped npm stages; `test:coverage` also runs the specifications and the pending check |
| | Coverage mode | Greenfield, at least 90% on domain and application |
| | Test architecture | [pinned stages](../concept/testing.md#pinned-stages) and [fixtures](../concept/testing.md#fixtures) |
| | Project-specific quality gates | "Specifications before code", and a feature file's wording changes only with the founder's review |
| `project_config_security.md` | Recipe, trust boundaries, auth | A local service on the local network. [Collector](../concept/domain-language.md#collector), command line and browser to the [API](../concept/domain-language.md#api): token, HTTPS. [Server](../concept/domain-language.md#server) to provider APIs: OAuth, read-only scopes, tokens encrypted. Server to the local model server: local address only. |
| | Sensitive data classes; adversary assumptions | [sensitive data](../concept/infrastructure.md#sensitive-data) |
| `project_config_infra.md` | Recipe, environments, rollback | One [server](../concept/domain-language.md#server), no cloud accounts; [server setup](../concept/infrastructure.md#server-setup); backup and restore ([backup](../concept/infrastructure.md#backup)) |
