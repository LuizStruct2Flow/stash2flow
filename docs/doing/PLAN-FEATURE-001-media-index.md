# Plan: [FEATURE-001](BACKLOG.md) media index

**Status:** reviewed by four reviewers and ruled on by the founder (2026-10-03).

- **Decided:** TypeScript (D1) · glossary rulings G1–G15 (D2) · the user is named (N5) ·
  public repo (D12) · private spec (D22) · videos keep only the provider hash (D13) ·
  senders decide which e-mails are indexed, by whitelist and blacklist (D23) · the
  order of sources decides the keeper, and a new file reopens a reviewed group (D24) ·
  a run starts by itself only 30 days after the source's last finished run (D25) ·
  backup to iCloud (D26) · open source, MIT (D27) · local models only, nothing built
  for hosted ones (D28) · specifications first, to fix the domain language (§3.2).
- **Open:** the names N1–N4 and N6 (§1.3) · D23 (a)–(c) · D3–D11, D14–D21 as
  recommended in §5 · how D12 is checked · how the D26 backup travels · the D27
  copyright line.

**Source of truth:** the spec, `docs/SPEC-media-index.md`. It is private: gitignored, kept only on the founder's machine (`L42` = spec line 42).
**Scope of this commit:** the plan only. No production code, no test code, no config edits.

**This repository is public.** Nothing tracked may carry the founder's account data:
no account names or addresses, no personal names, no folder or file names from his
sources, no machine names, no real document titles. Accounts, persons, senders and
keywords are data that lives outside the repo; examples and fixtures in tracked files
are invented.

---

## 1. Domain language

**Rule.** This glossary goes into `project_config_overview.md` §"Domain glossary" in
slice 0. Code, tests, feature files, logs, CLI and API use exactly these words. A
concept without an agreed word is not built until it has one. No agent adds a term;
a missing word is raised as a question to the founder.

### 1.1 Glossary

| Term | Meaning | From |
|---|---|---|
| server | The one local machine that runs the database, API, pullers, workers and scheduler | L24, L40 |
| source | One configured place files come from: a `location` + an `account` + an `owner` | L47, L59 |
| location | Which kind of place a source is. An open list, one value per source adapter (D27). Shipped: `onedrive`, `gdrive`, `icloud_drive`, `icloud_photos`, `email` | L59, D27 |
| account | Whose login the source is read with | L48–56, L59 |
| shared account | An account that belongs to more than one person; its files are flagged as also belonging to someone else | L50, L174, G6 |
| owner | Which machine reads the source: `server` or a collector name | L41, L59 |
| order of sources | The user's ranking of sources; the highest-ranked source in a duplicate group gives the keeper | D24 |
| puller | Server-side reader of one cloud source through its API | L27, L92 |
| collector | The program on a Mac that reads the sources that need macOS | L33, L41 |
| file | The unit that is indexed; one row. Keyed by (`location`, `account`, `source_file_id`) | L42, L134 |
| file record | What a puller or collector sends about one file | L92 |
| source_file_id | The file's id inside its source | L42, L137 |
| e-mail | One message in a mailbox | L73 |
| sender | Who an e-mail comes from (`email_from`) | L83, D23 |
| whitelist | The senders, kept by the user, whose e-mails are indexed | D23 |
| blacklist | The senders, kept by the user, from whom nothing is indexed | D23 |
| advertisement | An e-mail the user does not want indexed. Told by its sender being on the blacklist, never by a no-reply address | D23 |
| attachment | A PDF or image attached to an e-mail; indexed as a file. A picture inside the e-mail's text is not an attachment | L78, D23 |
| message body | The text of an e-mail; which bodies are indexed is D23 (a) | L79–80 |
| official sender, keyword | The spec's lists for indexing message bodies; their place next to the whitelist is D23 (a) | L79 |
| run | One pass over a source: first run (full), then incremental runs | L69, L84, L193, L215 |
| cursor | The stored position in a source's change feed | L69, L130 |
| checkpoint | How far an interrupted first run got; stored per source | L193, G11 |
| pipeline | The steps every file goes through | L90 |
| discovery | The pipeline step that lists a source and sends file records | L92 |
| provider | The company's API behind a location (G4) | L69–70 |
| provider hash | A hash the provider reports, used to skip downloads | L70, L95 |
| md5, sha256, phash | Hashes computed on the file's bytes; phash is the perceptual hash | L95–96 |
| OCR text | Text read from a page, stored per page in its original language | L17, L103–106 |
| text layer | Text already inside a PDF, used instead of OCR | L105 |
| has_text | Whether the file has enough OCR text to count | L108 |
| kind | `document`, `photo`, `screenshot`, `video`, `other` | L109 |
| description | One English line about a file of kind `document` | L110 |
| doc_type | Controlled English vocabulary (`tax`, `invoice`, …) | L112 |
| doc_date | The date printed on the document | L111 |
| person | Who the file is about or shows (from a list the user keeps) | L113, G9 |
| issuer | The institution that issued the document | L114 |
| file_date, file_date_source | Best available date of the file, and where it came from | L141–142 |
| embedding | A vector for a photo or for OCR text | L115–118 |
| duplicate group | Files that are the same; `exact` or `near` | L124, L163, L171–172 |
| exact, near | Same bytes; same image at another resolution or format | L9, L171–172 |
| keeper, non-keeper | The file suggested to keep in a duplicate group; the others | L173–174 |
| reviewed | Set by the user on a duplicate group; until then the keeper is only a suggestion | L164, D24 |
| duplicate report | The web page with thumbnails side by side, where the user changes a keeper and marks a group reviewed | L174, L216, D24 |
| open_link | The link that opens the file where it lives | L149, L184 |
| vanished, deleted_at | A file no longer in its source; the row stays and `deleted_at` is set | L93, G10 |
| collected_by | Which machine sent the file record; diagnostics only | L42, L152 |
| temp directory | Where downloads live until processing ends | L71 |
| worker | Server process doing OCR, embeddings or descriptions | L28 |
| scheduler | What starts a source's run by itself, 30 days after its last finished run | L29, D25 |
| summary notification | The message sent when a run finishes | L192 |
| place | Where a photo was taken | L8, L101 |
| user | The person who runs the app and makes its choices: order of sources, keeper, whitelist and blacklist, starting a run | N5 |

### 1.2 Conflicts in the spec — decided as recommended (founder, 2026-10-03)

| # | Conflict | Ruling |
|---|---|---|
| G1 | **scan** means a scanned paper and an indexing pass (`scan_runs`); the pass is also called **run** | **run** for the pass (table `runs`). **scan** only for a scanned paper. |
| G2 | **puller** (server) vs **collector** (Mac), yet `collected_by` covers both | Keep both: they are different programs. See N1 for what they share. |
| G3 | **file** vs **document** vs **photo** vs **scan** vs **attachment** | **file** is the only unit. document/photo are a file's `kind`. An attachment and an indexed message body are files. |
| G4 | **source** vs **location** vs **cloud** vs **provider** | **source** = location + account. **provider** = the company's API. "Cloud" is not a term. |
| G5 | **location** (kind of source) vs **place** (geography) | Both, strictly apart. |
| G6 | **owner** = the machine that reads a source, but files in a shared account also belong to a second person | `owner` is only the machine. The family case is a **shared account**. |
| G7 | **near** = duplicate kind and `--near "<place>"` | `near` is for duplicates. `--near` belongs to reverse geocoding, not in this item. |
| G8 | **type**: `--type tax`, "File types", `kind` | `kind`, `doc_type`, and `ext` for PDF/JPG. CLI flag is `--doc-type`. |
| G9 | **person** (one per document) vs **recognized people** in Photos | One word, **person**; a file can have several (D7). |
| G10 | **vanished** vs **deleted** | **vanished** in speech and specifications; `deleted_at` stays as the column. The system never deletes. |
| G11 | **cursor** vs **checkpointing** | Different: cursor = position in the provider's change feed; checkpoint = how far an interrupted first run got. |
| G12 | **server** vs the machine's model name vs **backend** vs **ingest API** | **server**, and **API** for what it serves. "Ingest" is one part of the API. |
| G13 | **bytes** vs **content** | **bytes**. |
| G14 | **dates**: `file_date`, `doc_date`, `mtime` | See D8. |
| G15 | **dup** / **dups** / **duplicate** | **duplicate**; `dups` only as the CLI command the spec names. |

### 1.3 Needs a name (not named here on purpose)

| # | What it denotes | Candidates |
|---|---|---|
| N1 | What a puller and a collector's source reader have in common: the thing that lists one source, reports its changes since the cursor, and hands over bytes. | (a) **puller** for both; (b) **source reader**; (c) no shared word, just "source" as the interface name |
| N2 | The server wanting a file's bytes from a collector (L97). The collector asks what is wanted; the server never calls a Mac. | (a) **bytes request**; (b) **upload request** |
| N3 | Which pipeline steps a file has completed, and with which model; includes "waiting for bytes". | (a) **processed steps**; (b) **pipeline state**; (c) one `…_at` timestamp per step, no collective word |
| N4 | One entry in a search answer (the spec only says "results", L184). | (a) **result**; (b) **match** |
| N5 | **Named (founder, 2026-10-03): user.** | — |
| N6 | What "run a source" talks to: it takes file records, keeps cursor and checkpoint, says which files are unchanged, marks vanished files (§2.2). | (a) **ingest**, the spec's word, stretched beyond taking file records; (b) two things, **ingest** and **cursor**; (c) no word, named after the use-case |

Placeholders used below, until he names them: "source reader" (N1), "ingest" (N6),
"result" (N4). N2 and N3 are referred to by number.

---

## 2. Architecture

Hexagonal, as [STACK_DEFAULTS.md](../../STACK_DEFAULTS.md) §Architecture: domain → application → ports → adapters,
dependencies point inward only.

### 2.1 What goes where

| Layer | Contents |
|---|---|
| **Domain** (no I/O, imports nothing but itself) | file and its key; source; run; duplicate group; the rules: what counts as unchanged, exact and near matching, keeper suggestion, `kind` and `has_text`, `file_date` choice, NFC names, `doc_type` vocabulary, which e-mails are indexed (whitelist, blacklist), which pipeline steps a file still needs (N3) |
| **Application** (use-cases; depends on domain and ports) | run a source (full, incremental, resumable; marks vanished files) · accept file records · process a file through the pipeline · process existing files for a step on request · group duplicates and suggest keepers · change a keeper, mark a group reviewed · sort senders · search · find photos · build the duplicate report · summarise a run |
| **Ports** | see below |
| **Adapters** | see below |

| Port | What it does | Adapters | First slice |
|---|---|---|---|
| source reader (N1) | list a source, report changes since a cursor, hand over bytes | Google Drive, OneDrive (Graph), Gmail, iCloud Drive (folder), iCloud Photos (`osxphotos`); fake | 2 |
| ingest (N6) | narrow; all that "run a source" needs (§2.2) | onto the index (server); API client (collector); fake | 2, cursor and checkpoint 3 |
| index | wide, server only: files, OCR text, embeddings, duplicate groups, runs, N3, senders | PostgreSQL (+ pgvector, unaccent, pg_trgm); in-memory fake | 2 |
| OCR | page image → text | the engine chosen in slice 1 (D3); fixture-replaying fake | 2 |
| file reading | metadata, phash, PDF text layer and page rendering, thumbnail | image and PDF libraries | 2 |
| temp directory · token store · clock | — | server directory · encrypted file on the server · system | 2 |
| description | OCR text → description, `doc_type`, `doc_date`, person, issuer | local model server (§2.6); fake | 6 |
| text embedding | OCR text and query text → vector | in-process model; fake | 7 |
| image embedding | a photo → vector, **and query text → vector in the same model**; the text-embedding port is no substitute | in-process model; fake | 10 |
| notification | — | per D10 | 11 |
| Driving side | API (ingest, search, duplicate report with its two changes), CLI `stash`, scheduler entry point | | |

No port is added before a slice needs it.

### 2.2 Running a source: server and collector share the use-case

One package, two entry points. Both wire the **same** "run a source" use-case and the
**same** hashing code, with different adapters:

| | server | collector |
|---|---|---|
| source readers | OneDrive, Google Drive, Gmail | iCloud Photos, iCloud Drive |
| ingest (N6) | straight onto the index | API client → the server's API |
| OCR, embeddings, description | yes | no |

The ingest port has five operations and nothing else: take a batch of file records
together with the position reached · give a source's stored cursor and checkpoint ·
answer per file record whether it is unchanged and whether its bytes are wanted ·
mark vanished files · record a run's start, finish and errors.

| Question | Answer |
|---|---|
| Where does a collector's cursor live? | On the server, in `sources`, like every other. The collector keeps no state; it reads cursor and checkpoint from the API when a run starts. |
| Who decides "unchanged"? | One domain rule, applied on the server when the file record arrives, against what the index holds. The reader never decides. |
| The rule | Same provider hash → unchanged. No provider hash: same size and mtime → unchanged. Otherwise sha256 decides (a collector computes it locally; the server after download). A newer date with the same hash is a file already read: the date is updated and no pipeline step runs again (founder, 2026-10-03). |
| When may a cursor or checkpoint advance? | The server stores a batch and its position in one transaction, then acknowledges. The reader moves on only after the acknowledgement. |
| A batch delivered twice | Changes nothing: file records are stored by the file's key. |
| Bytes of a collector's file (N2) | The server cannot call a Mac that may be asleep. The file waits (N3: waiting for bytes); the answer to the collector's next call lists the files wanted; the collector uploads them to the API, into the temp directory. |

Same phash code on both sides is what makes AC3 hold, so it is one implementation.

### 2.3 Pipeline steps over time (N3)

Slices add pipeline steps after files are already indexed, and downloads are deleted
after processing. So:

- Each file records which steps it has completed, and for a step done by a model,
  which model.
- An ordinary run processes a file only when it is new or changed. An unchanged file
  whose steps are all done costs nothing (AC5).
- When a step or a model is added, existing files get it **only when the user asks**.
  Description and text embedding need only the stored OCR text. Image embedding needs
  the bytes again, so that request downloads the photos a second time; this is
  accepted and said in the command's output.
- To avoid a second download where it is cheap, md5, sha256, phash and (if D15 is
  agreed) the thumbnail are all made from slice 2 on, while the bytes are in hand.

### 2.4 Directory layout

```
backend/
  package.json     ← the four scripts the gate calls: build, lint, format:check, test:coverage
  src/
    domain/
    application/
    ports/
    adapters/{sources,index,ocr,description,embeddings,api,cli,...}/
    server.ts      ← entry point: wires server adapters
    collector.ts   ← entry point: wires Mac adapters
  features/        ← *.feature, steps/ (step definitions), support/ (runner, pending check)
  spikes/          ← slice 1 benchmarks; not shipped, not counted for coverage
infra/             ← server setup as code (D11), backup script (D26)
```

Unit tests sit next to their source as `*.spec.ts`. `features/` is inside `backend/`
because the gate runs only `npm run …` there: `test:coverage` runs the unit tests and
then the specifications. `BP_TEST_ROOTS` is `backend/src`: the gate's bug-test stage
counts only `*.spec.*` files, never a `.feature`.

### 2.5 Dependency rule, enforced mechanically

A lint in the gate's lint stage (`eslint-plugin-boundaries` plus restricted imports):

| Rule | Why |
|---|---|
| Domain imports only domain: no Node built-ins, no packages | "no I/O" is otherwise unenforced |
| Application imports domain and ports; ports import domain | inward only |
| Adapters are imported only by the two entry points | |
| Step definitions import application, ports and fakes; real adapters only in the marked integration subset | step definitions are under the same lint |
| Code that starts an external program (`node:child_process`) is allowed in one place only: the iCloud Photos adapter | `osxphotos` is a command-line program, so an import rule cannot hold it |
| The Photos library package's name appears in no string under `backend/` | "never read the Photos library package directly" (L206) |

**Proven to bite:** slice 1 lands the lint with one rejected fixture per row. **What
the lint cannot see:** a path built at run time. The iCloud Photos adapter's contract
test, on recorded `osxphotos` output, is the second check.

### 2.6 Deviations from the stack defaults

| Default | This project | Why |
|---|---|---|
| AWS Lambda, serverless | Self-hosted server | No document text or image may leave the home network, and the local models need that machine (L43). |
| DynamoDB | PostgreSQL + pgvector + unaccent + pg_trgm | Full-text, fuzzy, vector and hash matching in one system (L124). |
| Hosted model APIs | Local models only (D28) | Privacy (L200); no billable path. |
| React/Next + Amplify | One server-rendered page, the duplicate report. It shows the groups and takes two changes: the keeper, and reviewed. Authenticated like every other client (D20). | One page does not warrant a frontend. |
| AWS CDK | Server setup scripted in `infra/` (D11) | No cloud resources exist. |
| CloudWatch observability recipe | "Local app" recipe: logs on the server, queryable `runs`, notification | Nothing runs in AWS. |
| CodeCommit | Public GitHub repository | Founder's choice (D12). |

### 2.7 Language, runtime and models — all TypeScript (D1)

Server and collector are one TypeScript package, so the gate works as shipped and
phash has one implementation. Two programs stay outside it, installed and called by
adapters: `osxphotos` (command-line, on the Mac) and a local model server.

| Model for | Runs | Configured by |
|---|---|---|
| OCR | Inside the app process (Tesseract, or a model through ONNX Runtime for Node). If the benchmark picks a local vision model instead: at the local model server. | model name |
| Text embedding | Inside the app process (`@huggingface/transformers`) | model name |
| Image embedding (photos and query text) | Inside the app process (`@huggingface/transformers`) | model name |
| Description | A local model server at a local address, over the OpenAI-compatible chat-completions HTTP API (what Ollama and llama.cpp's server speak). Needed from it: text in, text out; image in as well only if OCR goes this way. | address + model name |

The address must be loopback or in a private range (including the range VPNs use);
any other address is refused at start. There is no key and no switch (D28).

| Need | Candidate, to be proven in slice 1 | Known risk |
|---|---|---|
| PDF text layer, page rendering | `mupdf` or `pdfjs-dist` | none known |
| EXIF | `exifr` | none known |
| phash | `sharp` plus one small hash function | HEIC is not in `sharp`'s prebuilt binaries; needs a separate decoder, on Linux and on the Mac |
| OCR | as above; chosen by the benchmark (D3) | quality on poor Portuguese and German scans |
| Embeddings | as above | files per hour on the first full run, not measured |
| iCloud Photos | `osxphotos` as a command-line program | must be installed on the Mac |

Slice 1 has to prove the two doubts about this choice wrong: an OCR engine good
enough on the real scans, and HEIC decoding on both machines, both from TypeScript.

---

## 3. Test strategy — specifications first

### 3.1 Specifications (BDD)

- **Format:** Gherkin `.feature` files, one per area, in `backend/features/`. Runner:
  `@cucumber/cucumber`, run by `npm run test:coverage`.
- **What they run against:** the use-cases with fake adapters and fixtures (fast, in
  the gate). A small marked subset also runs against real PostgreSQL as integration.
- **Sources of scenarios:** the six acceptance criteria (L211–216) plus every stated
  rule and every decision in §5.

### 3.2 Why first, and what slice 0 proves

**Purpose (founder, 2026-10-03):** specifications come first so that the domain
language is fixed in the feature files, reviewed by him, before any agent writes
code. It keeps the language from drifting into an agent's own dialect. Proving red
is secondary.

1. **Slice 0 lands the feature files with their test code and no production code:**
   the runner setup, step-definition skeletons, and the pending check (below).
   `backend/src` does not exist yet. Every skeleton step fails with one fixed
   message saying it is not built.
2. **The founder reviews the feature files** (wording and coverage) before slice 1.
3. **Words.** Feature files and step definitions use only glossary words. After
   slice 0, a change to a feature file's wording is a founder-reviewed change: its
   own commit, listed for him at the handoff. A new scenario is written in glossary
   words; a missing word is a question to him, not a new term.
4. **Each scenario carries a tag naming the slice that makes it green** (`@slice-3`).
5. **The pending check.** `@cucumber/cucumber` has no strict "expected to fail", so
   a small wrapper reads its output and decides the gate. It has its own `*.spec.ts`,
   fed made-up runner output, one case per row:

   | Scenario | Outcome |
   |---|---|
   | tagged, fails on a skeleton step or on an assertion | pending, counted out loud per slice (DoD §3 rule 7) |
   | tagged, passes | gate fails: the tag must go in the slice that delivers it |
   | untagged, fails | gate fails |
   | any undefined or ambiguous step, an import error, any other error, or no output | gate fails: a broken harness cannot pass as pending |

6. **A slice is done** when its scenarios are untagged and green. No slice adds
   behaviour that has no scenario; a missing scenario is written first, in its own
   commit before the code.

| The slice-0 run | |
|---|---|
| proves | the harness loads; every step of every scenario has exactly one step definition; the pending check's four rules bite; N scenarios, N pending, counted per slice (in the commit body) |
| cannot prove | that a scenario is red for the right reason. A skeleton fails whatever the code does. That proof comes in the scenario's own slice: the step bodies are written first against the fakes and seen failing on their assertion before the code, and the slice's commit body says so. |

### 3.3 TDD inside a slice

Outside-in: the slice's failing scenario → failing unit tests on the use-case (fake
adapters) → failing unit tests on domain rules → code. Then each real adapter gets a
**contract test**: the same test runs against the fake and the real adapter, so the
fake cannot drift. The ingest contract test includes a batch delivered twice and an
interruption between storing a batch and its acknowledgement.

| Layer | Runs | Notes |
|---|---|---|
| Specifications | gate, CI | fakes + fixtures |
| Unit (domain, application) | gate, CI | coverage ≥90% on these two layers |
| Adapter contract: PostgreSQL | gate if a local database is present, else skips out loud; always in CI | real extensions (unaccent, pg_trgm, pgvector) |
| Adapter contract: provider APIs, `osxphotos` | release tier / on the machine | recorded responses in the gate |
| Models (OCR, description, embeddings) | on the server only | never called in the gate |

**CI.** The shipped workflow runs no backend stage and has no database. Slice 1 adds
a project-owned workflow that runs the four `backend/` scripts with a PostgreSQL
service carrying the three extensions.

### 3.4 Non-deterministic stages and how they are pinned (DoD §3 rule 2)

| Stage | Pinned by |
|---|---|
| OCR | Captured OCR text per fixture file, with provenance (engine, version, date, input sha256) |
| Description | Captured outputs with provenance; domain validates shape (`doc_type` in vocabulary, one line) |
| Embeddings | Captured vectors for fixture files and fixture queries, photo and query text from the same model |
| Provider APIs | Recorded responses with ids and names replaced |
| `osxphotos` | Recorded output for a small made-up library |

**No real personal document is ever committed.** Fixtures are made-up look-alikes: a
mock Portuguese tax receipt and a mock German tax notice with invented names, invented
issuers and invalid ids, both also as image-only PDF and JPG; non-personal photos with
resized, recompressed and HEIC copies; invented senders. Real documents are used only
on the server: for the benchmarks (only totals are committed) and for the founder's
acceptance.

### 3.5 Draft scenario titles (wording for his review; full Gherkin is slice 0)

`[n]` is the slice that makes the scenario green; this list is the one place that
says so. † = checked by tests only; the user cannot see it in the app. *(prov.)* =
wording depends on an open decision and is fixed when that is ruled.

**Search**
- [2] A scan with no text layer is found by its OCR text *(AC2)*
- [2] Search ignores accents: "certidao" finds "Certidão"
- [2] Search tolerates OCR misreadings: "recibo" finds a page read as "rec1bo"
- [2] Every result carries an open_link
- [3] A vanished file is left out of results, and the answer says how many were left out *(D9, prov.)*
- [6] Search filters by doc_type
- [6] Search filters by person
- [6] Search filters by date range *(D8, prov.)*
- [7] A query in another language finds the document: English words find a Portuguese receipt

**Runs**
- [2] The user can start a run at any time *(D25)*
- [2] † A run never writes to a source
- [2] † Downloads are gone from the temp directory after processing
- [2] † File names are stored in NFC
- [3] An interrupted run resumes where it stopped *(AC1)*
- [3] A second run with no changes downloads nothing and processes nothing *(AC5)*
- [3] A file that shows a newer date but has the same hash is recognised as already read and is not processed again
- [3] A changed file is processed again
- [3] A file that vanished from its source keeps its row and gets deleted_at
- [3] A file that fails is recorded in the run's errors and the run goes on
- [3] The user can see a run's state and its errors
- [3] † A source's cursor moves only when every file record up to it is stored
- [9] A full run over all sources finishes *(AC1)*
- [11] A run starts by itself only when 30 days have passed since the source's last finished run *(D25)*
- [11] A source with no finished run does not start by itself *(D25)*
- [11] A run that failed or was interrupted does not move the date *(D25)*
- [11] Running one source does not postpone the others *(D25)*
- [11] A Mac that was asleep when its run was due runs when it wakes
- [11] A summary notification reports new files, new duplicates and errors

**Pipeline**
- [2] A PDF with a text layer is not sent to OCR
- [2] Every image and every PDF without a text layer gets OCR *(D19, prov.)*
- [2] OCR text is stored per page in its original language
- [2] file_date uses the best available date and records its source
- [4] A video gets metadata and its provider hash; it is not downloaded and gets no OCR *(D13)*
- [6] kind and has_text follow the agreed examples *(D19, prov.)*
- [6] Only a file of kind document gets a description
- [6] A description is one English line and keeps proper names verbatim
- [6] doc_type always comes from the vocabulary
- [6] A file indexed before a pipeline step existed gets that step only when the user asks for it

**Duplicates**
- [8] The same bytes in two sources form one exact group
- [8] An attachment that also exists in Google Drive lands in the same exact group
- [8] A resized or recompressed copy joins the near group
- [8] Different photos are not grouped
- [8] The keeper is suggested from the user's order of sources *(D24)*
- [8] Inside the winning source, ties go to the highest resolution, then complete EXIF, then the oldest *(D24)*
- [8] The user can change the keeper of a duplicate group in the duplicate report *(D24)*
- [8] A suggested keeper stays a suggestion until the user marks the group reviewed *(D24)*
- [8] A new file joining a reviewed group puts it back to not reviewed, and the user's earlier keeper stays as the suggestion *(D24)*
- [8] The duplicate report shows thumbnails and paths side by side *(AC6)*
- [8] The duplicate report refuses a change without valid credentials *(D20)*
- [8] Files in a shared account are flagged as also belonging to someone else
- [8] † Nothing is ever deleted or moved automatically
- [9] The same photo as JPG in OneDrive and HEIC in iCloud Photos lands in one near group *(AC3)*

**Collectors**
- [2] The API refuses a call without valid credentials
- [9] The same file seen by both Macs is one row *(AC4)*
- [9] A collector uploads a file's bytes only when the server wants them
- [9] † A collector interrupted after sending file records sends them again and nothing is doubled

**E-mail**
- [5] Nothing from a sender on the blacklist is indexed, attachments included *(D23)*
- [5] An attachment from a sender on the whitelist is indexed as a file and goes through the same pipeline *(D23)*
- [5] A no-reply sender is not taken for advertisement: an invoice from a whitelisted no-reply sender is indexed *(D23)*
- [5] A picture inside an e-mail's text, such as a logo, is not an attachment *(D23)*
- [5] An attachment's file_date is the date received
- [5] An attachment's open_link opens its Gmail thread
- [5] An e-mail from a sender on the whitelist has its body indexed *(D23 a, prov.)*
- [5] Nothing from a sender on neither list is indexed *(D23 b, prov.)*
- [5] The run summary lists the new senders with a count and the provider's hints *(D23 b, prov.)*
- [5] After the user puts a sender on the whitelist, the next run indexes that sender's earlier e-mails too *(D23 b, prov.)*
- [5] The first e-mail run indexes nothing: it lists the senders for the user to sort *(D23 b, prov.)*

**Photos**
- [9] Albums, persons, favorites and place from iCloud Photos are kept
- [10] Photos are found by month
- [10] Photos are found by what they show: "beach" finds a beach photo whose name says nothing

**Privacy**
- [2] Processing a file uses local models only *(D28)*
- [2] † OAuth tokens are stored encrypted and every scope is read-only
- [9] † iCloud Photos is read only through osxphotos

---

## 4. Slices

Each ends in something the founder can run. A slice makes green the scenarios marked
with its number in §3.5.

| # | Delivers (what the founder can do) | Adds |
|---|---|---|
| 0 | Read and approve the glossary and all feature files. No production code. | glossary into config; `backend/package.json` with the gate's four scripts; `backend/features/` with step-definition skeletons and the pending check with its own test (§3.2) |
| 1 | **Pick the OCR engine and see that TypeScript carries the load**, on made-up and real files, on the server and a Mac. He sees one table: OCR quality per candidate on a sample of the real scans (D3); a made-up HEIC decoded on Linux and on the Mac giving the same phash, and within the near threshold of its JPG copy; files per hour for the chosen OCR and for both embeddings, extended to 100,000 files. Green: none. | `backend/spikes/`; layering lint with its rejected fixtures (§2.5); project CI workflow with PostgreSQL (§3.3); the D12 check |
| 2 | **First search.** `stash search "<words printed on a scan>"` over one Google Drive account, after a full run. | ports: source reader, ingest (file records only), index, OCR, file reading, temp directory, token store, clock. Adapters: Google Drive, PostgreSQL, OCR, API (with authentication), CLI. All hashes and metadata made while the bytes are in hand (§2.3) |
| 3 | **Second run costs nothing.** Run again: nothing downloaded; interrupt and resume; remove a file and see it kept with deleted_at; see a run's state and errors. | ingest: cursor, checkpoint, unchanged, vanished, runs (§2.2); N3, including "waiting for bytes" |
| 4 | **All server file sources.** Every OneDrive and Google Drive account searchable; videos indexed. | adapter: OneDrive (Graph); further accounts by configuration |
| 5 | **E-mail.** The first e-mail run lists the senders with counts and hints; he sorts them into whitelist and blacklist; the next run makes the whitelisted senders' attachments (and bodies, D23 a) searchable. Placed early because official receipts often exist only as attachments (L75). | adapter: Gmail, reporting sender and provider hints per e-mail; whitelist and blacklist, stored in the database, kept through the CLI |
| 6 | **Descriptions and filters.** `stash search --doc-type tax --person <name> --from 2005 --to 2015`; each document shows its one-line description. Files already indexed get their description on request. | port + adapter: description (local model server); processing existing files for a step on request (§2.3) |
| 7 | **Search across languages.** English words find a Portuguese receipt. | port + adapter: text embedding; pgvector |
| 8 | **Duplicates.** `stash dups --report` opens the page with thumbnails, keepers suggested from his order of sources, shared-account files flagged; he changes a keeper and marks a group reviewed there. | grouping; order of sources (a column on the source, kept through the CLI); report page with its write path, authentication (D20) and stored choices; a group keeps its id when files join it |
| 9 | **Mac collector.** iCloud Drive and iCloud Photos from a Mac; bytes when the server wants them. | collector entry point; adapters: iCloud Drive, iCloud Photos, ingest over the API; N2 on the API |
| 10 | **Photos.** `stash photos --date 2024-07`, `--query "beach"`. Photos already indexed get their embedding on request, downloaded once more. | port + adapter: image embedding, for photos and query text |
| 11 | **Stays current.** A run starts by itself 30 days after the source's last finished run (D25), on the server and through launchd on the Mac; summary notification. | scheduler entry, launchd agent, notification adapter |

**Named non-slices** (not built in this item): searching photos by place, reverse
geocoding and `--near` — so the spec's goal "find photos by place" is **not met by
this item**: place is stored, not searchable · hosted models (D28) · MCP server ·
Apache AGE · IMAP and other mailboxes · moving non-keepers into `_to_review/` (D6) ·
enabling a second Mac's collector (configuration only, when needed) · cleaning up
unnecessary content, parked as [FEATURE-002](../backlog/BACKLOG.md).

---

## 5. Decisions

| # | Decision | Recommendation (open points only) |
|---|---|---|
| D1 | **Decided (founder, 2026-10-03): all TypeScript** (§2.7). | — |
| D2 | **Decided (founder, 2026-10-03): G1–G15 as recommended.** Open: the names N1–N4 and N6 (§1.3). | His to name. |
| D3 | OCR engine, description model, embedding models. The spec says benchmark first (L104). | Slice 1 picks the OCR engine on real scans and measures files per hour for OCR and both embeddings. The description model is picked the same way at slice 6. Candidates must run on the server's hardware. |
| D4 | **A file can be in an exact and a near group at once, but `files.dup_group_id` holds one group** (L153 vs L163). | One group per file: files with the same image are one group; it is `exact` when all bytes match, otherwise `near`. |
| D5 | **Exact = "same sha256 (or md5)"** (L171): which decides? | sha256 decides; md5 is stored because it is required (L95). |
| D6 | Moving non-keepers into `_to_review/` is "optional" (L174) and the only write to a source. In this item? | No. Report only. A later item, with its own specifications. |
| D7 | `person` is one text column (L146), but documents and photos can concern several persons. | Several persons per file. |
| D8 | Which date do `--from/--to` and `--date` filter on? **Decided next to it (founder, 2026-10-03):** a file that shows a newer date but has the same hash is recognised as already read and is not processed again (§2.2). | Documents: `doc_date`, falling back to `file_date`. Photos: `file_date`. Known limit: a wrongly read `doc_date` hides the file from a date filter. |
| D9 | Do vanished files show up in search? | Hidden by default, shown with a flag; the answer says how many were left out. |
| D10 | Summary notification: no channel named (L192). | E-mail or a chat webhook, counts only, no file names or text. Founder picks the channel. |
| D11 | How the server is installed and kept (database, API, workers, timer). | Scripted in `infra/` as systemd units rather than containers, because the models need the machine's hardware; settled at slice 1. The machine can be rebuilt from the repo. |
| D12 | **Decided (founder, 2026-10-03): the repo is public on GitHub.** The spec is gitignored and no account data is committed. Open: how that is checked. | A gate check that refuses a push whose tracked files contain any value from the private configuration (account addresses, person names, senders). Lands in slice 1, before the first source is wired. |
| D13 | **Decided (founder, 2026-10-03): the gap is accepted.** The first run downloads every file once (sha256 needs the bytes, L95); later runs skip by provider hash (L70). Videos are not downloaded: only the provider hash is stored. Known limit: the same video at two different providers is not recognised as an exact duplicate. | — |
| D14 | **AC4 vs "one owner per source"** (L41, L59 vs L214). Two Macs can only see the same file if both read the same source, and a source has one owner. | A source is unique by (location, account); `owner` says who normally reads it; file records from another collector for the same source update the same row (`collected_by` records who). |
| D15 | **Thumbnails vs "no mirror"** (L174, L216 vs L71, L205). The report needs thumbnails after downloads are deleted. | Keep small thumbnails on the server, stated as the one exception to "no mirror"; made from slice 2 on (§2.3). |
| D16 | Gmail `source_file_id = message_id/attachment_id` (L81): Gmail's attachment id may not be stable between calls. No id is given for a message body. | Verify in slice 5; if unstable use the message id plus the attachment's part number. Body: `message_id/body`. |
| D17 | Near matching on PDFs uses the first page's phash (L96): two different letters on the same letterhead may match. | Slice 8 measures it on fixtures; if it happens, near groups are limited to images and PDFs match only exactly. |
| D18 | iCloud Photos with "Optimize Mac Storage": originals may not be on the Mac. | The collector asks `osxphotos` to download the original when the server wants the bytes; confirm the Mac's setting before slice 9. |
| D19 | Not defined in the spec: how `screenshot` is told from `photo`, the `has_text` threshold, what "complete EXIF" means (L108–109, L173), and **which files get OCR before `kind` exists** (slice 2). | The first three: examples in the slice-0 feature files, for his review. OCR: every image and every PDF without a text layer, as the spec orders the pipeline (OCR at L103, then `has_text` and `kind` from its result at L108–109); videos never. If slice 1's files per hour make that too slow for the first run, he decides then whether photos from iCloud Photos skip OCR. |
| D20 | Who may call the API besides collectors (CLI, the duplicate report in a browser)? L197 only names collectors. The report now takes changes (D24), so it cannot stay open. | Everything authenticates; one token per client; HTTPS on the LAN. |
| D21 | Slice order: e-mail at 5 (before descriptions and duplicates). | Keep: the first use case may live only in an e-mail attachment. |
| D22 | **Decided (founder, 2026-10-03): the spec is private and gitignored.** The feature files of slice 0 are the public statement of what the system does, so they must be complete without the spec. | — |
| D23 | **Decided (founder, 2026-10-03): senders decide which e-mails are indexed.** The user keeps a **whitelist** and a **blacklist** of senders. Blacklist: nothing is indexed, attachments included. Whitelist: indexed. A no-reply sender is not a sign of advertisement, because transaction e-mails (invoices, receipts) come from such senders. A picture inside an e-mail's text is never an attachment. The provider's hints are reported by the adapter; the domain decides. **Open:** (a) is the whitelist the same list as the spec's official senders (L79), or a second one? (b) what happens to a sender on neither list? (c) a sender put on the blacklist after its e-mails were indexed. | (a) One list. A whitelisted sender's attachments and body are indexed, as the spec says for official senders. The spec's keywords then no longer decide anything; a keyword match becomes one more hint when sorting. (b) Nothing from that sender is indexed yet. The run summary lists the new senders with a count and the provider's hints (filed under promotions, has an unsubscribe header) as a suggested sorting, and the user puts each on one list. The first e-mail run therefore starts with sorting senders, before anything is indexed; a sender put on the whitelist has its earlier e-mails indexed by the next run. (c) Nothing new is indexed; what is already indexed stays until he says otherwise. |
| D24 | **Decided (founder, 2026-10-03): the user's order of sources decides the keeper, and nothing is deleted without his go.** What wins is a source, not a location. He sets the order once; the duplicate report shows the keeper that order gives, and he can change it per group. Nothing counts as chosen until he marks the group reviewed (L164). The spec's resolution, EXIF and age rules only break ties inside the winning source. **Also decided:** when a new file joins a group he already reviewed, the group goes back to not reviewed and his earlier keeper stays as the suggestion. The order of sources is stored in the database with the sources, so the backup covers it (D26). | — |
| D25 | **Decided (founder, 2026-10-03): runs are started by the user; a run starts by itself only when 30 days have passed since that source's last finished run.** This replaces the spec's fixed day of the month (L190). The 30 days count per source, from `last_run_at` (L131), so running one source does not postpone the others. Only a finished run moves the date. A source with no finished run does not start by itself: the first run is the user's (L193). | — |
| D26 | **Decided (founder, 2026-10-03): the backup goes to iCloud**, so L199 now reads "encrypted before it leaves the server". The app builds nothing for backup; `infra/` ships one script. It covers the database (his choices cannot be rebuilt by a run: reviewed groups, keepers, order of sources, whitelist and blacklist), the configuration file and the token store. Open: how it gets to iCloud, since the server runs Linux and iCloud has no client for it. | The script writes one encrypted, dated file per run; a Mac fetches it from the server into a folder of its iCloud Drive, and macOS uploads it. That folder is left out of the index, because iCloud Drive is also a source. Not recommended: `rclone` writing to iCloud straight from the server, whose login has to be renewed by hand. |
| D27 | **Decided (founder, 2026-10-03): the app is open source (MIT), for people with other infrastructure and other sources.** What that binds: (1) a new source is a new adapter and a configuration entry, with no change to domain or use-cases, so `location` is an open list; (2) nothing about one installation is in the code: sources, accounts, persons, senders, model names and the model server's address are configuration or data; (3) which model does a step is configuration: a model name for those inside the app process, an address for the local model server (§2.7); (4) the server installs from the repo on any Linux machine with PostgreSQL, and the Mac collector is optional; (5) backup is the installer's own tool (D26). Not built: a plug-in system; the ports are the extension point. Open: the copyright line of the `LICENSE` file, which puts a name in a public file. | His call: his name, or a neutral holder such as "the stash2flow authors". |
| D28 | **Decided (founder, 2026-10-03): hosted models are dropped from this item.** The model ports stay. This item builds and tests local models only and ships no setting for a model outside the user's network (§2.7). Someone who wants a hosted model writes that adapter, with the cost controls of AGENTS.md §"Cost is a main concern". | — |
| D29 | **A frontend is coming as its own item, [FEATURE-003](BACKLOG.md)** (founder, 2026-10-03): everything organized by a taxonomy, plus a search over all content. It is not built here, but it touches this item in three places. Open: (a) the duplicate report is planned here as a page of its own, and would become a screen of that frontend; (b) sorting a file into the taxonomy would be a pipeline step next to the description, and may replace `doc_type` and `person`; (c) the API must serve a frontend, not only the CLI. | (a) Keep slice 8's report as the plain page it is; the frontend takes it over later, since the choices it stores (keeper, reviewed) do not change. (b) Decide with the frontend's plan, before slice 6 starts, because slice 6 is where `doc_type` and `person` are built; §2.3 already lets a new step run over files that are indexed. (c) Nothing extra: the search and report already go through the API. |
| D30 | **Decided (founder, 2026-10-03): the server keeps a local copy of every file it indexes.** This reverses the spec's "no mirror" rule (L71, L205) and its "not a backup system" (L207). The reason is where he wants to end up: once everything is organized in a clean structure and taxonomy, he cleans all his cloud drives and keeps one clean copy, for instance in iCloud. A source can only be cleaned when a verified copy exists elsewhere, so the copies start here. What it changes in this item: the temp directory becomes a kept store of files, addressed by sha256 so exact duplicates are stored once; later pipeline steps read from it and no file is downloaded twice (§2.3); a Mac collector uploads every file's bytes, not only on request (N2 falls away); D13's video gap closes for videos that are copied; D15's thumbnail exception is no longer an exception. Open: (a) videos, which may be large; (b) the disk holds every private document, so it must be encrypted. | (a) The first run reports each source's total size before it downloads anything, and he decides about videos with real numbers. (b) Check the server's disk before slice 2 and encrypt it if it is not. The plan's sections that still describe the temp directory are revised with these rulings before slice 0. |
| D31 | **Decided (founder, 2026-10-03): the app measures the user's own case before and after.** Nobody has measured how much stored data is trash (see `README.md`), but one case can be measured: his. What this item must do so the "before" is not lost: the first full run of each source records, and keeps unchanged afterwards, the number of files and bytes in that source, and once duplicates are grouped, the share that is duplicates. For e-mail it also records the count of messages from senders that end up on the blacklist. The "after" is the same figures read again, and belongs to the items that organize and clean up. Open: (a) which figures exactly, and the word for the kept "before" figures; (b) whether his own before and after are published in the README. | (a) Per source: files, bytes, exact duplicates, near duplicates, and for e-mail the blacklisted share. Overall: the number of sources a file is found in. The word is his to choose, for instance **baseline**. (b) His call: they are figures about his accounts, and the repository is public. If published, only totals and shares, no names. |

---

## 6. Config FEATURE-001 will fill (list only; nothing edited yet)

| File | Section | What goes in |
|---|---|---|
| `project_config_overview.md` | What this project does; Core USP paths | Search (find a document by its text), runs (nothing lost, nothing re-done), duplicates never deleted, privacy |
| | Tech stack | TypeScript, PostgreSQL, local models; each deviation with its sentence (§2.6) |
| | Observability stack | Local recipe: server logs, `runs` and their errors queryable by the agent, summary notification (D10) |
| | Cost stack | No billable path: all models local (D28), provider APIs free and read-only |
| | Documentation stack | Recipe A (README only) |
| | Domain glossary | §1 |
| `project_config_paths.md` | Repository layout; `BP_TEST_ROOTS` | `backend/`, `infra/`; `BP_TEST_ROOTS: backend/src` |
| | `BP_CI` | `github-actions`, plus the project-owned workflow (§3.3) |
| | External integrations | Microsoft Graph, Google Drive API, Gmail API |
| `project_config_dod.md` | Pre-push gate commands | The shipped npm stages; `test:coverage` also runs the specifications and the pending check |
| | Coverage mode | Greenfield, ≥90% on domain and application |
| | Test architecture | The non-deterministic stages and fixtures of §3.4 |
| | Project-specific quality gates | "Specifications before code", and a feature file's wording changes only with the founder's review (§3.2) |
| `project_config_security.md` | Recipe, trust boundaries, auth | Local service on the LAN: collector/CLI/browser → API (token, HTTPS); server → provider APIs (OAuth, read-only scopes, tokens encrypted); server → local model server (local address only) |
| | Sensitive data classes | Tax ids and identity documents in OCR text; e-mail content and senders; photos with GPS and persons; OAuth tokens; encrypted backups |
| | Adversary assumptions | Another device on the LAN; a stolen server disk or backup; a leaked token |
| `project_config_infra.md` | Recipe, environments, rollback | One server, no cloud accounts; setup per D11; backup and restore (D26) |
