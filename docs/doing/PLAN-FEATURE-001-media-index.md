# Plan: [FEATURE-001](BACKLOG.md) media index

**Status:** draft with the founder. Decided on 2026-10-03: TypeScript (D1), the
glossary rulings G1–G15 as recommended (D2), public repo (D12), private spec (D22),
the founder's order of sources decides the keeper (D24), a source runs by itself only
30 days after its last finished run (D25), the app is open source (D27).
Open: the four names in §1.3 and the rest of §5, which wait until he has read the
spec again. Then it goes to the three-provider plan review.
**Source of truth:** the spec, `docs/SPEC-media-index.md`. It is private: gitignored, kept only on the founder's machine (`L42` = spec line 42).
**Scope of this commit:** plan and backlog row only. No production code, no test code, no config edits.

**This repository is public.** Nothing tracked may carry the founder's account data:
no account names or addresses, no personal names, no folder or file names from his
sources, no machine names, no real document titles. Accounts, persons, official
senders and keywords are configuration that lives outside the repo; examples and
fixtures in tracked files are invented.

---

## 1. Domain language — to be ruled on first

**Rule.** Once agreed, this glossary goes into `project_config_overview.md` §"Domain
glossary". Code, tests, feature files, logs, CLI and API use exactly these words. A
concept without an agreed word is not built until it has one. No agent adds a term;
a missing word is raised as a question to the founder.

### 1.1 Proposed glossary (only words the spec already uses)

| Term | Meaning | Spec |
|---|---|---|
| server | The one local machine that runs the database, API, pullers, workers and scheduler | L24, L40 |
| source | One configured place files come from: a `location` + an `account` + an `owner` | L47, L59 |
| location | Which kind of place a source is: `onedrive`, `gdrive`, `icloud_drive`, `icloud_photos`, `email` | L59 |
| account | Whose login the source is read with | L48–56, L59 |
| owner | Which machine reads the source: `server` or a collector name | L41, L59 |
| puller | Server-side reader of one cloud source through its API | L27, L92 |
| collector | The program on a Mac that reads the sources that need macOS | L33, L41 |
| file | The unit that is indexed; one row. Keyed by (`location`, `account`, `source_file_id`) | L42, L134 |
| file record | What a puller or collector sends about one file | L92 |
| source_file_id | The file's id inside its source | L42, L137 |
| attachment | A PDF or image attached to an e-mail message; indexed as a file | L78 |
| message body | The text of an e-mail message; indexed only for official senders or keywords | L79–80 |
| official sender, keyword | The configurable lists that decide which message bodies are indexed | L79 |
| run | One pass over a source: first run (full), then incremental runs | L69, L84, L193, L215 |
| cursor | The stored position in a source's change feed | L69, L130 |
| pipeline | The steps every file goes through | L90 |
| discovery | The pipeline step that lists a source and sends file records | L92 |
| provider hash | A hash the cloud provider reports, used to skip downloads | L70, L95 |
| md5, sha256, phash | Hashes computed on the file's bytes; phash is the perceptual hash | L95–96 |
| OCR text | Text read from a page, stored per page in its original language | L17, L103–106 |
| text layer | Text already inside a PDF, used instead of OCR | L105 |
| has_text | Whether the file has enough OCR text to count | L108 |
| kind | `document`, `photo`, `screenshot`, `video`, `other` | L109 |
| description | One English line about a file of kind `document` | L110 |
| doc_type | Controlled English vocabulary (`tax`, `invoice`, …) | L112 |
| doc_date | The date printed on the document | L111 |
| person | Who the document is about (a family member, from a configured list) | L113 |
| issuer | The institution that issued the document | L114 |
| file_date, file_date_source | Best available date of the file, and where it came from | L141–142 |
| embedding | A vector for a photo (CLIP) or for OCR text | L115–118 |
| duplicate group | Files that are the same; `exact` or `near` | L124, L163, L171–172 |
| exact, near | Same bytes; same image at another resolution or format | L9, L171–172 |
| keeper, non-keeper | The file suggested to keep in a duplicate group; the others | L173–174 |
| duplicate report | The web page with thumbnails side by side | L174, L216 |
| open_link | The link that opens the file where it lives | L149, L184 |
| deleted_at | Set when a file vanished from its source; the row stays | L93 |
| collected_by | Which machine sent the file record; diagnostics only | L42, L152 |
| temp directory | Where downloads live until processing ends | L71 |
| worker | Server process doing OCR, embeddings or descriptions | L28 |
| scheduler | What starts the monthly run | L29, L190 |
| summary notification | The message sent when a run finishes | L192 |
| place | Where a photo was taken | L8, L101 |

### 1.2 Conflicts in the spec — agreed as recommended (founder, 2026-10-03)

| # | Conflict | Question | Recommendation |
|---|---|---|---|
| G1 | **scan** means a scanned paper (L7, L63, L141) and an indexing pass (L10, L211, `scan_runs` L166); the pass is also called **run** (L69, L84, L215) | Which word for the pass? | **run** for the pass (`full run`, `incremental run`, table `runs`). **scan** only for a scanned paper. |
| G2 | **puller** (server) vs **collector** (Mac), yet `collected_by` and "collecting machine" (L42) cover both | Two programs, or one word? | Keep both: they are different programs. See N1 for what they share. |
| G3 | **file** vs **document** vs **photo** vs **scan** vs **attachment** | What is the unit? | **file** is the only unit. document/photo are a file's `kind`. An attachment and an indexed message body are files. "Document" alone is never used for "any file". |
| G4 | **source** vs **location** vs **cloud** (L5) vs **provider** (L69–70); "across all sources and accounts" (L171) | Is `location` the provider? | No: **source** = location + account. **provider** = the company's API (Gmail, Graph); it matters because `email` is one location with two providers once IMAP comes. Drop "cloud" as a term. |
| G5 | **location** (kind of source) vs **place** (geography) | Keep both? | Yes, strictly: `location` never means geography, `place` never means a source. |
| G6 | **owner** = the machine that reads a source (L59), but files in a shared account also belong to a second person (L174) | Does owner ever mean a person? | No. `owner` is only the machine. The family case is a **shared account** (L50). |
| G7 | **near** = duplicate kind (L172) and `--near "<place>"` = close to a place (L182) | Rename one? | Keep `near` for duplicates. `--near` belongs to reverse geocoding, which is optional and not in this item; pick its word then. |
| G8 | **type**: `--type tax` (L181) = `doc_type`; "File types" (L86) = PDF/JPG; plus `kind` | Three words for classification? | `kind`, `doc_type`, and `ext` for PDF/JPG. CLI flag becomes `--doc-type`. |
| G9 | **person** (L113, one per document) vs **recognized people** in Photos (L101) | Same concept? | Yes: one word, **person**, and a file can have several. See D7. |
| G10 | **vanished** (L93) vs **deleted** (`deleted_at`, `files_deleted`) | Which word? | **vanished** in speech and specifications ("the file vanished from its source"); `deleted_at` stays as the column. "Deleted" alone is avoided because the system never deletes. |
| G11 | **cursor** (L69) vs **checkpointing** (L193) | Same thing? | No. **cursor** = position in the provider's change feed. **checkpoint** = how far an interrupted first run got. Both are stored per source. |
| G12 | **server** vs the machine's model name vs **backend** vs **Backend API** vs **ingest API** | Which names? | **server** (the machine and what runs on it), **API** (what it serves). "Ingest" is one part of the API, not a second API. "Backend" and the machine's model name are not used in code. |
| G13 | **bytes** (L97) vs **content** (L70) | Which? | **bytes**. |
| G14 | **dates**: `file_date`, `doc_date`, `mtime`; `--from/--to` and `--date` do not say which | Which date do filters use? | See D8. |
| G15 | **dup** / **dups** / **duplicate** | Abbreviate? | Speak and write **duplicate**; `dups` only as the CLI command the spec already names. |

### 1.3 Needs a name (not named here on purpose)

| # | What it denotes | Candidates |
|---|---|---|
| N1 | What a puller and a collector's source reader have in common: the thing that lists one source, reports its changes since the cursor, and hands over bytes. The code needs one word for it. | (a) **puller** for both, the collector being the Mac program that runs pullers; (b) **source reader**; (c) no shared word, just "source" as the interface name |
| N2 | The server asking a collector for a file's bytes (L97). | (a) **bytes request**; (b) **upload request** |
| N3 | Which pipeline steps a file has already been through. Needed so a resumed or second run "reprocesses nothing" (L215); the schema has no column for it. | (a) **processed steps**; (b) **pipeline state**; (c) one `…_at` timestamp per step, no collective word |
| N4 | One entry in a search answer (the spec only says "results", L184). | (a) **result**; (b) **match** |
| N5 | The person who runs the app and makes its choices (order of sources, keeper, starting a run). The spec names its author; an open-source app (D27) needs a word that fits anyone. The scenarios below still say "the founder" until this is named. `owner` is taken: it is the machine that reads a source. | (a) **user**; (b) **you**, written as an instruction in the feature files |

The rest of this plan uses the recommendations above, and "source reader" (N1) as a
placeholder only.

---

## 2. Architecture

Hexagonal, as [STACK_DEFAULTS.md](../../STACK_DEFAULTS.md) §Architecture: domain → application → ports → adapters,
dependencies point inward only.

### 2.1 What goes where

| Layer | Contents |
|---|---|
| **Domain** (no imports from outside itself, no I/O) | file and its key; source; run; duplicate group; the rules: what counts as unchanged, exact and near matching, keeper suggestion, `kind` and `has_text`, `file_date` choice, NFC names, `doc_type` vocabulary, which message bodies are indexed |
| **Application** (use-cases; depends on domain and ports) | run a source (full, incremental, resumable; marks vanished files) · accept file records (ingest) · process a file through the pipeline · group duplicates and suggest keepers · search · find photos · build the duplicate report · summarise a run |
| **Ports** (interfaces the use-cases call) | source reader (N1) · index (files, OCR text, embeddings, duplicate groups, runs, cursors) · OCR · file reading (metadata, phash, PDF page rendering) · description · text embedding · image embedding · temp directory · token store · notification · clock |
| **Adapters** | see below |

| Port | Adapters |
|---|---|
| source reader | OneDrive (Graph), Google Drive, Gmail, iCloud Drive (folder), iCloud Photos (`osxphotos`); a fake for tests |
| index | PostgreSQL (+ pgvector, unaccent, pg_trgm); in-memory fake for tests |
| OCR / description / embeddings | the local models chosen by the benchmark (D3); fixture-replaying fakes |
| file reading | image and PDF libraries |
| token store | encrypted file on the server |
| notification | per D10 |
| Driving side | API (ingest, search, report page), CLI `stash`, scheduler entry point |

No port is added before a slice needs it. One adapter per port is fine where the
port exists to keep I/O out of the core and make it testable (OCR, index).

### 2.2 Server and Mac collector share code

One package, two entry points. Both wire the **same** "run a source" use-case and
the **same** hashing code, with different adapters:

| | server | collector |
|---|---|---|
| source readers | OneDrive, Google Drive, Gmail | iCloud Photos, iCloud Drive |
| where file records go | index (PostgreSQL) | API client → server's ingest |
| OCR, embeddings, description | yes | no |

Same phash code on both sides is what makes AC3 hold, so it must be one implementation.

### 2.3 Directory layout (names follow the glossary once agreed)

```
backend/
  src/stash/
    domain/
    application/
    ports/
    adapters/{sources,index,ocr,description,embeddings,api,cli,...}/
    server      ← entry point: wires server adapters
    collector   ← entry point: wires Mac adapters
features/        ← specifications (.feature) + step definitions (§3)
infra/           ← server setup as code (D11)
```

Unit tests sit next to their source. `backend/` is the directory the blueprint gate
already looks for.

### 2.4 Dependency rule, enforced mechanically

- A layering lint in the gate's lint stage (`eslint-plugin-boundaries`): domain
  imports nothing outward;
  application imports domain and ports only; adapters are imported only by the two
  entry points; `osxphotos` is importable only from the iCloud Photos adapter (this is
  also how "never read the Photos library package directly" is held).
- Proven to bite: slice 1 lands the lint together with one deliberately wrong import
  in a test fixture that the lint must reject.

### 2.5 Deviations from the stack defaults

| Default | This project | Why |
|---|---|---|
| AWS Lambda, serverless | Self-hosted server | No document text or image may leave the home network, and the local models need that machine (L43). |
| DynamoDB | PostgreSQL + pgvector + unaccent + pg_trgm | Full-text, fuzzy, vector and hash matching in one system (L124). |
| Hosted model APIs | Local models only | Privacy (L200); also means no billable path. |
| React/Next + Amplify | One server-rendered page (the duplicate report) | A single read-only page does not warrant a frontend. |
| AWS CDK | Server setup scripted in `infra/` (D11) | No cloud resources exist. |
| CloudWatch observability recipe | "Local app" recipe: logs on the server, queryable `runs`, notification | Nothing runs in AWS. |
| CodeCommit | Public GitHub repository | Founder's choice; the spec and all account data stay out of the repo (D12). |
| Node/TypeScript | Node/TypeScript | No deviation (D1). |

### 2.6 Language and runtime — decided: all TypeScript (founder, 2026-10-03)

The Python libraries the spec names were examples. Server and collector are one
TypeScript package, so the gate works as shipped and phash has one implementation.
Two things stay outside TypeScript as installed programs the adapters call, not as
libraries in this codebase: `osxphotos` (command-line, on the Mac) and a local model
server for descriptions.

| Need | Candidate, to be proven in slice 1 | Known risk |
|---|---|---|
| PDF text layer, page rendering | `mupdf` or `pdfjs-dist` | none known |
| EXIF | `exifr` | none known |
| phash | `sharp` plus one small hash function | HEIC is not in `sharp`'s prebuilt binaries; needs a separate decoder |
| OCR | Tesseract, a PaddleOCR model through ONNX Runtime for Node, or a local vision model; chosen by the benchmark (D3) | quality on poor Portuguese and German scans |
| Embeddings (CLIP, multilingual text) | `@huggingface/transformers` in Node | speed of the first full run, not measured |
| Description | local model server over HTTP | none known |
| iCloud Photos | `osxphotos` as a command-line tool | must be installed on the Mac |

The options as they were weighed (record):

| Option | For | Against |
|---|---|---|
| **A. All Python** (server and collector) | Every library the spec names is Python (`osxphotos`, `imagehash`, `open_clip`, PaddleOCR/docTR). One package shared by server and collector, so one phash. STACK_DEFAULTS names "a Python ML project" as a normal override. | Blueprint gate assumes npm: `backend/` stages call `npm run build/lint/format:check/test:coverage`, so a small `backend/package.json` must forward to ruff/mypy/pytest. DoD §3 fixes `*.spec.ts`; the gate's bug-test stage counts only `.spec.ts/.tsx/.js/.jsx/.mjs/.cjs`, so a Python test naming a `BUG-NNN` would not count until the blueprint accepts `*_spec.py` (a back-propagation request). Sonar and coverage wiring redone for Python. |
| **B. TypeScript core, Python behind ports** (OCR, CLIP, phash as local Python services; Python collector) | Core matches the default and the gate as-is. | Two languages and toolchains. The collector must be Python anyway, so server and collector no longer share the run and hashing code; phash exists twice or always crosses a process boundary. More moving parts on the server. |
| **C. All TypeScript** (models via local HTTP servers, `osxphotos` as a command-line tool, a JS phash) | One language, gate as-is. | OCR and CLIP still need a Python service; HEIC decoding in Node on Linux is fragile; leaves the libraries the spec chose. |

The draft recommended A; the founder chose C. C's "against" column is what slice 1
has to prove wrong: an OCR engine good enough on the real scans, and HEIC decoding on
the server, both from TypeScript.

---

## 3. Test strategy — specifications first

### 3.1 Specifications (BDD)

- **Format:** Gherkin `.feature` files, written in the agreed glossary, one file per
  area. Runner: `@cucumber/cucumber`.
- **Where:** `features/` at the repo root, a root of its own (not under `docs/`,
  `scripts/`, or a subdirectory of `tests/`). `BP_TEST_ROOTS` becomes
  `backend/src features` (§6).
- **What they run against:** the use-cases with fake adapters and fixtures (fast, in
  the gate). A small marked subset also runs against real PostgreSQL as integration.
- **Sources of scenarios:** the six acceptance criteria (L211–216) plus every stated
  rule: never delete automatically, shared-account flag, read-only, no mirror,
  accent-insensitive and cross-language search, vanished file keeps its row, e-mail
  rules.

### 3.2 The ordering gate

1. **Slice 0 commits every specification before any production code exists.** Evidence
   is commit order: the slice-0 commit touches only `features/` and docs, and
   `backend/src` does not exist yet.
2. **The founder reviews the feature files** (wording and coverage) before slice 1 starts.
3. **Red without a broken gate:** each scenario carries a tag naming the slice that
   makes it green (`@slice-3`). The runner treats a tagged scenario as *expected to
   fail, strictly*: it is reported out loud as `pending: slice 3` with a count (DoD §3
   rule 7: no silent skip); an **untagged** failing scenario fails the gate; a
   **tagged scenario that passes** also fails the gate, so the tag must be removed in
   the slice that delivers it.
4. **Proof they are really red:** the slice-0 commit body carries one run with the
   tags ignored: N scenarios, N failing.
5. **A slice is done** when its scenarios are untagged and green. No slice adds
   behaviour that has no scenario; a missing scenario is written first, in its own
   commit before the code.

### 3.3 TDD inside a slice

Outside-in: the slice's failing scenario → failing unit tests on the use-case (fake
adapters) → failing unit tests on domain rules → code. Then each real adapter gets a
**contract test**: the same test runs against the fake and the real adapter, so the
fake cannot drift.

| Layer | Runs | Notes |
|---|---|---|
| Specifications | gate | fakes + fixtures |
| Unit (domain, application) | gate | coverage ≥90% on these two layers |
| Adapter contract: PostgreSQL | gate if a local database is present, else skips out loud; CI | real extensions (unaccent, pg_trgm, pgvector) |
| Adapter contract: cloud APIs, `osxphotos` | release tier / on the machine | recorded responses in the gate |
| Models (OCR, description, embeddings) | on the server only | never called in the gate |

### 3.4 Non-deterministic stages and how they are pinned (DoD §3 rule 2)

| Stage | Pinned by |
|---|---|
| OCR | Captured OCR text per fixture file, with provenance (engine, version, date, input sha256) |
| Description (local LLM) | Captured outputs with provenance; domain validates shape (`doc_type` in vocabulary, one line) |
| Embeddings | Captured vectors for fixture files and fixture queries |
| Cloud APIs | Recorded responses with ids and names replaced |
| `osxphotos` | Recorded output for a small made-up library |

**No real personal document is ever committed.** Fixtures are made-up look-alikes
created for the project: a mock Portuguese tax receipt and a mock German tax notice,
with invented names, invented issuers and invalid ids, both also as image-only PDF
and JPG; and non-personal photos with resized, recompressed and HEIC
copies. Real documents are used only on the server: for the OCR benchmark (only
totals are committed) and for the founder's acceptance.

### 3.5 Draft scenario titles (wording for review; full Gherkin is slice 0)

**Search**
- A scan with no text layer is found by its OCR text *(AC2)*
- Search ignores accents: "certidao" finds "Certidão"
- Search tolerates OCR misreadings
- A query in another language finds the document: English words find a Portuguese receipt
- Search filters by doc_type, person and date range
- Every result carries an open_link
- A vanished file is left out of results unless asked for *(D9)*

**Runs**
- A full run over all sources finishes *(AC1)*
- An interrupted run resumes where it stopped *(AC1)*
- A second run with no changes downloads nothing and reprocesses nothing *(AC5)*
- A changed file is processed again
- A file that vanished from its source keeps its row and gets deleted_at
- A file that fails is recorded in the run's errors and the run goes on
- A run never writes to a source
- Downloads are gone from the temp directory after processing
- File names are stored in NFC
- The founder can start a run himself at any time *(D25)*
- Every finished run schedules the next run of its source 30 days later *(D25)*
- A run that failed or was interrupted does not move the date *(D25)*
- Running one source does not postpone the others *(D25)*
- A run starts by itself only when 30 days have passed since the source's last finished run *(D25)*
- A Mac that was asleep when its run was due runs when it wakes
- A summary notification reports new files, new duplicates and errors

**Pipeline**
- A PDF with a text layer is not sent to OCR
- OCR text is stored per page in its original language
- A video gets metadata and hashes, no OCR
- Only a file of kind document gets a description
- A description is one English line and keeps proper names verbatim
- doc_type always comes from the vocabulary
- file_date uses the best available date and records its source

**Duplicates**
- The same bytes in two sources form one exact group
- The same photo as JPG in OneDrive and HEIC in iCloud Photos lands in one near group *(AC3)*
- A resized or WhatsApp-compressed copy joins the near group
- Different photos are not grouped
- The keeper is suggested from the founder's order of sources *(D24)*
- Inside the winning source, ties go to the highest resolution, then complete EXIF, then the oldest *(D24)*
- The founder can change the keeper of a duplicate group in the duplicate report *(D24)*
- A suggested keeper stays a suggestion until the founder marks the group reviewed *(D24)*
- Nothing is ever deleted or moved automatically
- The duplicate report shows thumbnails and paths side by side *(AC6)*
- Files in a shared account are flagged as also belonging to someone else

**Collectors**
- The same file seen by both Macs is one row *(AC4)*
- A collector uploads bytes only when the server asks
- The API refuses a collector without valid credentials

**E-mail**
- A PDF attachment is indexed as a file and goes through the same pipeline
- An attachment that also exists in Google Drive lands in the same exact group
- A message from an official sender has its body indexed
- A message matching a keyword has its body indexed
- An ordinary message body is not indexed
- An advertisement is not indexed, and neither are its attachments *(D23)*
- A picture inside a message's text, such as a logo, is not an attachment *(D23)*
- The run summary counts the advertisements that were left out *(D23)*
- An attachment's file_date is the date received
- An attachment's open_link opens its Gmail thread
- The first run covers full history: messages with attachments plus official senders, leaving out advertisements

**Photos**
- Photos are found by month
- Photos are found by what they show: "beach"
- Albums, persons, favorites and place from iCloud Photos are kept

**Privacy**
- Processing a file uses local models only
- OAuth tokens are stored encrypted and every scope is read-only
- iCloud Photos is read only through osxphotos

---

## 4. Slices

Each ends in something the founder can run. Specifications named are the ones that
go green.

| # | Delivers (what the founder can do) | Goes green | Adds |
|---|---|---|---|
| 0 | Read and approve the glossary and all feature files. No code. | none (all pending) | glossary into config; `features/` |
| 1 | **Pick the OCR engine**: benchmark the candidates on a sample of the real scans, on the server; founder sees the table and chooses (D3). Also: project skeleton, gate wired for the chosen language, layering lint. | none | spike kept out of `src/`; gate + lint |
| 2 | **First search.** `stash search "<words printed on a scan>"` over one Google Drive account, after a full run. | Search: AC2 (for this source), accents, misreadings, open_link. Pipeline: text layer, per-page text. Runs: read-only, temp directory, NFC. Privacy: tokens. | ports: source reader, index, OCR, file reading, temp directory, token store. Adapters: Google Drive, PostgreSQL, OCR, API (with authentication), CLI |
| 3 | **Second run costs nothing.** Run again: nothing downloaded; interrupt and resume; remove a file and see it kept with deleted_at. | AC5, resume, changed, vanished, errors recorded | cursor, checkpoint, runs; N3 |
| 4 | **All server file sources.** Every OneDrive and Google Drive account searchable; videos indexed. | AC1 for these sources; video | adapters: OneDrive (Graph); second accounts by config |
| 5 | **E-mail.** Attachments and official-sender bodies from every Gmail account searchable. Placed early because official receipts often exist only as attachments (L75). | all E-mail scenarios except the cross-source duplicate | adapter: Gmail; official-sender and keyword lists |
| 6 | **Descriptions and filters.** `stash search --doc-type tax --person <name> --from 2005 --to 2015`; each document shows its one-line description. | description, doc_type, kind, has_text, file_date, filters | port + adapter: description (local LLM) |
| 7 | **Search across languages.** English words find a Portuguese receipt. | cross-language search | port + adapter: text embedding; pgvector |
| 8 | **Duplicates.** `stash dups --report` opens the page with thumbnails, keepers suggested, shared-account files flagged. | all Duplicates scenarios except AC3; e-mail/Drive exact group; AC6 | phash; report page |
| 9 | **Mac collector.** iCloud Drive and iCloud Photos from a Mac; bytes on request. | AC3, AC4, Collectors, osxphotos rule | collector entry point; adapters: iCloud Drive, iCloud Photos; ingest |
| 10 | **Photos.** `stash photos --date 2024-07`, `--query "beach"`. | Photos scenarios | port + adapter: image embedding (CLIP) |
| 11 | **Stays current.** A run starts by itself 30 days after the last one (D25), on the server and through launchd on the Mac; summary notification. | AC1 complete; schedule; summary | scheduler entry, launchd agent, notification adapter |

**Named non-slices** (not built in this item): MCP server · Apache AGE · IMAP and
other mailboxes · reverse geocoding and `--near` · moving non-keepers into
`_to_review/` (D6) · enabling a second Mac's collector (configuration only, when needed)
· cleaning up unnecessary content, parked as [FEATURE-002](../backlog/BACKLOG.md).

---

## 5. Open decisions for the founder

| # | Decision | Recommendation |
|---|---|---|
| D1 | **Decided (founder, 2026-10-03): all TypeScript** (§2.6). | — |
| D2 | **G1–G15 decided (founder, 2026-10-03): as recommended.** Still open: the names N1–N4 (§1.3). | N1–N4 are his to name. |
| D3 | OCR engine, description LLM, embedding models. The spec says benchmark first (L104). | Slice 1 benchmarks OCR on real scans on the server; the LLM and embedding models are chosen the same way at slices 6, 7 and 10. Candidates must run on the server's hardware. |
| D4 | **A file can be in an exact and a near group at once, but `files.dup_group_id` holds one group** (L153 vs L163). | One group per file: files with the same image are one group; it is `exact` when all bytes match, otherwise `near`. |
| D5 | **Exact = "same sha256 (or md5)"** (L171): which decides? | sha256 decides; md5 is stored because it is required (L95). |
| D6 | Moving non-keepers into `_to_review/` is "optional" (L174) and the only write to a source. In this item? | No. Report only. A later item, with its own specifications. |
| D7 | `person` is one text column (L146), but documents and photos can concern several persons. | Several persons per file. |
| D8 | Which date do `--from/--to` and `--date` filter on? | Documents: `doc_date`, falling back to `file_date`. Photos: `file_date`. |
| D9 | Do vanished files show up in search? | Hidden by default, shown with a flag. |
| D10 | Summary notification: no channel named (L192). | E-mail or a chat webhook, counts only, no file names or text. Founder picks the channel. |
| D11 | How the server is installed and kept (database, API, workers, timer). | Scripted in `infra/` (containers or systemd units, decided at slice 1) so the machine can be rebuilt from the repo. |
| D12 | **Decided (founder, 2026-10-03): the repo is public on GitHub.** The spec is gitignored, and no account data is hardcoded or committed. Still open: how that is checked. | A gate check that refuses a push whose tracked files contain any value from the private configuration (account addresses, person names, official senders). Lands in slice 1, before the first source is wired. |
| D13 | **Hashes "on the actual bytes" (L95) vs "skip downloads" (L70).** sha256 needs every file downloaded once, videos included. | First run downloads everything once; later runs skip by provider hash. For videos, store the provider hash only and do not download. |
| D14 | **AC4 vs "one owner per source"** (L41, L59 vs L214). Two Macs can only see the same file if both read the same source; the schema keys files by `source_id`, and a source has one owner. | A source is unique by (location, account); `owner` says who normally reads it; file records from another collector for the same source are accepted and update the same row (`collected_by` records who). |
| D15 | **Thumbnails vs "no mirror"** (L174, L216 vs L71, L205). The report needs thumbnails after downloads are deleted. | Keep small thumbnails on the server, stated as the one exception to "no mirror". |
| D16 | Gmail `source_file_id = message_id/attachment_id` (L81): Gmail's attachment id may not be stable between calls. No id is given for a message body. | Verify in slice 5; if unstable use the message id plus the attachment's part number. Body: `message_id/body`. |
| D17 | Near matching on PDFs uses the first page's phash (L96): two different letters on the same letterhead may match. | Slice 8 measures it on fixtures; if it happens, near groups are limited to images and PDFs match only exactly. |
| D18 | iCloud Photos with "Optimize Mac Storage": originals may not be on the Mac. | Collector asks `osxphotos` to download the original when the server requests bytes; confirm the Mac's setting before slice 9. |
| D19 | How `screenshot` is told from `photo`, the `has_text` threshold, and what "complete EXIF" means (L108–109, L173) are not defined. | Define each as examples in the slice-0 feature files, for his review. |
| D20 | Who may call the API besides collectors (CLI, the report page in a browser)? L197 only names collectors. | Everything authenticates; one token per client; HTTPS on the LAN. |
| D21 | Slice order: e-mail at 5 (before descriptions and duplicates). | Keep: the first use case may live only in an e-mail attachment. |
| D22 | **Decided (founder, 2026-10-03): the spec is private and gitignored.** A clone therefore has the plan and the feature files but not the spec. | The feature files of slice 0 become the public statement of what the system does, so they must be complete without the spec. |
| D23 | **Which e-mails are kept track of.** Founder, 2026-10-03: only the ones that are personal or have relevant content; about 95% are expected to be advertisement. The spec's first-run filter (L84, every message with an attachment) would take in advertisements, because their logos count as attachments. Open: (a) the rule that tells an advertisement from the rest; (b) whether the body of a personal message is indexed, or only its attachments (L79–80 index bodies for official senders and keywords only). | (a) A message is **relevant** when its sender is an official sender, it matches a keyword, or it carries a PDF attachment. It is **personal** when Gmail does not file it under Promotions, Social, Spam or Trash and it has no unsubscribe header. Everything else is an **advertisement**: nothing is stored, it is only counted. Pictures inside the message text are never attachments. Slice 5 first reports the counts per rule on the real mailboxes and the founder checks a sample of what is left out, before the rule is fixed. (b) Attachments only, as the spec says; his call. |
| D24 | **Decided (founder, 2026-10-03): as recommended on both points; what wins is a source.** Who decides the keeper. Founder, 2026-10-03: "All content that will be deduplicated I have to choose the location that wins", and "No content will be deleted without my go". The second is already the spec's rule (L174) and stands. The first changes the keeper: the spec suggests it by resolution, EXIF, iCloud Photos, age (L173). Open: (a) does he choose once, as an order of preference that applies to every duplicate group, or group by group in the duplicate report? (b) is the thing that wins a **location** (`onedrive`, `icloud_photos`) or a **source** (a location plus an account)? With two accounts in one location, a location cannot settle it. | (a) Both, the first feeding the second: he sets the order once in configuration, the report shows the keeper that order gives, and he can change it per group. Nothing counts as chosen until he marks the group reviewed (`dup_groups.reviewed`, L164). The spec's resolution and EXIF rules only break ties inside the winning source. (b) Source. |
| D25 | **Decided (founder, 2026-10-03): runs are started by him; each run schedules the next for 30 days later, so a run only starts by itself when he has not run one in that time.** This replaces the spec's fixed day of the month (L190). Also decided: the 30 days are counted per source, from the `last_run_at` the spec already stores (L131), so running one source by hand does not postpone the others. And only a finished run moves the date, not one that failed or was interrupted. | — |
| D26 | **Backup of the database.** The spec keeps backups encrypted and on hardware the founder controls (L199). He asked about alternatives such as AWS Glacier. What must be backed up is small: the index can be rebuilt by a full run, at the cost of days of OCR, but his choices (reviewed duplicate groups, keepers, order of sources) cannot. | The app builds nothing for backup. `infra/` ships one script: `pg_dump` into `restic`, which encrypts before anything leaves the server and can write to a local disk, a NAS, or any object store, chosen by configuration. Start with a second disk; an off-site copy is his call, because it changes L199 from "hardware he controls" to "encrypted before it leaves". Glacier fits poorly: the data is small, restores take hours, and its minimum storage time is charged on every replaced backup. |
| D27 | **Decided (founder, 2026-10-03): the app is open source, and people have different infrastructure and different sources.** What that binds: (1) a new source is a new adapter and a configuration entry, with no change to domain or use-cases, so `location` is an open list, not a fixed one; (2) nothing about one installation is in the code: sources, accounts, persons, official senders, keywords, model names and addresses are configuration; (3) models are reached through an address, so any machine or model server works; (4) the server installs from the repo on any Linux machine with PostgreSQL, and the Mac collector is optional; (5) backup is the installer's own tool (D26). Not built: a plug-in system. The ports are the extension point. Open: (a) the licence; (b) the word for the person using the app (N5). | (a) His call; MIT or Apache-2.0 if anyone may reuse it freely, AGPL-3.0 if changes to a hosted copy must be shared. (b) See N5. |

---

## 6. Config FEATURE-001 will fill (list only; nothing edited yet)

| File | Section | What goes in |
|---|---|---|
| `project_config_overview.md` | What this project does; Core USP paths | Search (find a document by its text), runs (nothing lost, nothing re-done), duplicates never deleted, privacy |
| | Tech stack | Result of D1, PostgreSQL, local models; each deviation with its sentence (§2.5) |
| | Observability stack | Local recipe: server logs, `runs` and their errors queryable by the agent, summary notification (D10) |
| | Cost stack | No billable path: all models local, provider APIs free and read-only |
| | Documentation stack | Recipe A (README only) |
| | Domain glossary | §1 once agreed |
| `project_config_paths.md` | Repository layout; `BP_TEST_ROOTS` | `backend/`, `features/`, `infra/`; `BP_TEST_ROOTS: backend/src features` |
| | `BP_CI` | Per D12 |
| | External integrations | Microsoft Graph, Google Drive API, Gmail API |
| `project_config_dod.md` | Pre-push gate commands | The shipped npm stages, plus the specifications stage |
| | Coverage mode | Greenfield, ≥90% on domain and application |
| | Test architecture | The non-deterministic stages and fixtures of §3.4 |
| | Project-specific quality gates | "Specifications before code" (§3.2) |
| `project_config_security.md` | Recipe, trust boundaries, auth | Local service on the LAN: collector/CLI/browser → API (token, HTTPS); server → provider APIs (OAuth, read-only scopes, tokens encrypted) |
| | Sensitive data classes | Tax ids and identity documents in OCR text; e-mail content; photos with GPS and persons; OAuth tokens; encrypted backups |
| | Adversary assumptions | Another device on the LAN; a stolen server disk or backup; a leaked token |
| `project_config_infra.md` | Recipe, environments, rollback | One server, no cloud accounts; setup per D11; database backup and restore |
