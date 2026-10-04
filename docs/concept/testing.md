# Testing

How stash2flow is tested, and why the specifications are written before any
code. Read this before writing a feature file, a test or a fixture. The slices
it refers to are the delivery steps of the
[plan](../doing/PLAN-FEATURE-001-media-index.md#slices).

## Specifications first

`#specifications-first`

Specifications come first so that the domain language is fixed in the feature
files, reviewed by the founder, **before any agent writes code**. It keeps the
language from drifting into an agent's own dialect. Proving that a test fails
before the code exists is secondary.

How it works:

- **Format.** Gherkin `.feature` files, one per area, in `backend/features/`.
  They are run by `@cucumber/cucumber` as part of `npm run test:coverage`.
- **What they run against.** The use-cases with fake adapters and fixtures:
  fast, in the gate. A small marked subset also runs against a real PostgreSQL.
- **Where scenarios come from.** The [acceptance](#acceptance) criteria, plus
  every rule stated in these concept documents.
- **Words.** Feature files and step definitions use only the words in
  [domain-language.md](domain-language.md). A missing word is a question to the
  founder, not a new term.
- **A change of wording is the founder's.** After slice 0, a change to a
  feature file's wording is its own commit, listed for him at the handoff.
- **Complete by themselves.** The feature files are the public statement of
  what the app does. See
  [public repository](principles.md#public-repository).
- **No behaviour without a scenario.** A missing scenario is written first, in
  its own commit before the code.
- **Done.** Each scenario carries a tag naming the slice that makes it green,
  for example `@slice-3`. A slice is done when its scenarios are untagged and
  green.

## What slice 0 proves

`#what-slice-0-proves`

Slice 0 lands the feature files with their test code and **no production
code**: the runner setup, a skeleton for every step, and the
[pending check](#pending-check). Every skeleton step fails with one fixed
message saying it is not built. The founder then reviews the feature files,
wording and coverage, before slice 1 starts.

| The slice-0 run | |
|---|---|
| proves | The harness loads. Every step of every scenario has exactly one step definition. The pending check's four rules bite. The number of scenarios and of pending scenarios, counted per slice. |
| cannot prove | That a scenario is red for the right reason: a skeleton fails whatever the code does. That proof comes in the scenario's own slice, where the step bodies are written first against the fakes and seen failing on their assertion before the code. |

Slice 0 does not start before the founder has named the concepts in
[words still to name](domain-language.md#words-still-to-name), because the
feature files must use his words.

## Pending check

`#pending-check`

The runner has no strict "expected to fail". So a small wrapper reads its
output and decides whether the gate passes:

| Scenario | Outcome |
|---|---|
| tagged for a later slice, fails on a skeleton step or on an assertion | pending, counted out loud per slice |
| tagged, but passes | the gate fails: the tag must go in the slice that delivers it |
| untagged, fails | the gate fails |
| any undefined or ambiguous step, an import error, any other error, or no output | the gate fails: a broken harness cannot pass as pending |

The wrapper has its own unit test, fed made-up runner output, one case per row.

## TDD inside a slice

`#tdd-inside-a-slice`

Outside-in:

1. the slice's failing scenario;
2. failing unit tests on the use-case, with fake adapters;
3. failing unit tests on the domain rules;
4. the code.

Then each real adapter gets a **contract test**: the same test runs against the
fake and against the real adapter, so the fake cannot drift. The contract test
for what a [run](domain-language.md#run) talks to includes a batch delivered
twice, and an interruption between storing a batch and acknowledging it.

## Test layers

`#test-layers`

| Layer | Runs | Notes |
|---|---|---|
| Specifications | gate, CI | fakes and fixtures |
| Unit tests (domain, application) | gate, CI | coverage of at least 90% on these two layers |
| Adapter contract: PostgreSQL | gate if a local database is present, otherwise skipped out loud; always in CI | with the real extensions |
| Adapter contract: provider APIs, `osxphotos` | before a release, on the machine | recorded responses in the gate |
| Models (OCR, description, embeddings) | on the server only | never called in the gate |

## Continuous integration

`#continuous-integration`

The workflow that ships with the project's framework runs no backend stage and
has no database. Slice 1 adds a project-owned workflow that runs the four
`backend/` scripts with a PostgreSQL service carrying the three extensions.

## Pinned stages

`#pinned-stages`

Some stages do not give the same answer twice. Tests never call them; they
replay a captured answer:

| Stage | Pinned by |
|---|---|
| OCR | Captured [OCR text](domain-language.md#ocr-text) per fixture file, with where it came from: engine, version, date, and the [sha256](domain-language.md#md5-and-sha256) of the input |
| [Description](domain-language.md#description) | Captured outputs with where they came from; the domain checks the shape ([doc_type](domain-language.md#doc_type) in the vocabulary, one line) |
| [Embeddings](domain-language.md#embedding) | Captured vectors for fixture files and fixture queries, photo and query text from the same model |
| [Provider](domain-language.md#provider) APIs | Recorded responses with ids and names replaced |
| `osxphotos` | Recorded output for a small made-up library |

## Fixtures

`#fixtures`

**No real personal document is ever committed.** Fixtures are made-up
look-alikes:

- a mock Portuguese tax receipt and a mock German tax notice, with invented
  names, invented [issuers](domain-language.md#issuer) and invalid ids, each
  also as an image-only PDF and as a JPG;
- non-personal photos, with resized, recompressed and HEIC copies;
- invented [senders](domain-language.md#sender).

Real documents are used only on the [server](domain-language.md#server): for the
benchmarks, of which only totals are committed, and for the founder's
acceptance.

## Acceptance

`#acceptance`

The index is accepted when these six hold:

1. A full [run](domain-language.md#run) over all
   [sources](domain-language.md#source) finishes, and resumes after an
   interruption.
2. A search for words printed on a document finds it if it exists in any
   source, even when it was scanned as an image with no
   [text layer](domain-language.md#text-layer).
3. The same photo as a JPG in a cloud drive and as a HEIC in iCloud Photos
   lands in the same [near](domain-language.md#near) group.
4. The same [file](domain-language.md#file) seen by two Macs is one row, not
   two.
5. A second [run](domain-language.md#run) with no changes finishes in minutes,
   downloads nothing and processes nothing again.
6. The [duplicate report](domain-language.md#duplicate-report) opens in a
   browser with thumbnails and paths.

## Draft scenario titles

`#draft-scenario-titles`

Wording for the founder's review. The full Gherkin is written in slice 0.

- `[n]` is the slice that makes the scenario green. This list is the one place
  that says so.
- † means checked by tests only: the user cannot see it in the app.
- *provisional* means the wording depends on an open question, linked next to
  it, and is fixed when that is ruled.
- *new* means the title follows from the decision that the
  [server](domain-language.md#server) keeps a
  [local copy](principles.md#local-copy) and has not been reviewed yet.

**Search**

- [2] A [scan](domain-language.md#scan) with no [text layer](domain-language.md#text-layer) is found by its [OCR text](domain-language.md#ocr-text)
- [2] Search ignores accents: "certidao" finds "Certidão"
- [2] Search tolerates OCR misreadings: "recibo" finds a page read as "rec1bo"
- [2] Every entry in a search answer carries an [open_link](domain-language.md#open_link)
- [3] A [vanished](domain-language.md#vanished) [file](domain-language.md#file) is left out of the answer, and the answer says how many were left out *(provisional: [open question: vanished in search](open-questions.md#question-vanished-in-search))*
- [6] Search filters by [doc_type](domain-language.md#doc_type)
- [6] Search filters by [person](domain-language.md#person)
- [6] Search filters by date range *(provisional: [open question: date filter](open-questions.md#question-date-filter))*
- [7] A query in another language finds the document: English words find a Portuguese receipt

**Runs**

- [2] The [user](domain-language.md#user) can start a [run](domain-language.md#run) at any time
- [2] † A run never writes to a [source](domain-language.md#source)
- [2] † The [server](domain-language.md#server) keeps a local copy of every [file](domain-language.md#file) it indexes *(new)*
- [2] † The same [bytes](domain-language.md#bytes) arriving from two [sources](domain-language.md#source) are stored once *(new)*
- [2] † [File](domain-language.md#file) names are stored in NFC
- [3] An interrupted [run](domain-language.md#run) resumes where it stopped
- [3] A second [run](domain-language.md#run) with no changes downloads nothing and processes nothing
- [3] A [file](domain-language.md#file) that shows a newer date but has the same hash is recognised as already read and is not processed again
- [3] A changed [file](domain-language.md#file) is processed again
- [3] A [file](domain-language.md#file) that [vanished](domain-language.md#vanished) from its [source](domain-language.md#source) keeps its row and gets deleted_at
- [3] A [file](domain-language.md#file) that fails is recorded in the [run](domain-language.md#run)'s errors and the run goes on
- [3] The [user](domain-language.md#user) can see a [run](domain-language.md#run)'s state and its errors
- [3] † A [source](domain-language.md#source)'s [cursor](domain-language.md#cursor) moves only when every [file record](domain-language.md#file-record) up to it is stored
- [9] A full [run](domain-language.md#run) over all [sources](domain-language.md#source) finishes
- [11] A [run](domain-language.md#run) starts by itself only when 30 days have passed since the [source](domain-language.md#source)'s last finished run
- [11] A [source](domain-language.md#source) with no finished [run](domain-language.md#run) does not start by itself
- [11] A [run](domain-language.md#run) that failed or was interrupted does not move the date
- [11] Running one [source](domain-language.md#source) does not postpone the others
- [11] A Mac that was asleep when its [run](domain-language.md#run) was due runs when it wakes
- [11] A [summary notification](domain-language.md#summary-notification) reports new [files](domain-language.md#file), new [duplicates](domain-language.md#duplicate) and errors

**Pipeline**

- [2] A PDF with a [text layer](domain-language.md#text-layer) is not sent to OCR
- [2] Every image and every PDF without a [text layer](domain-language.md#text-layer) gets OCR *(provisional: [open question: which files get OCR](open-questions.md#question-which-files-get-ocr))*
- [2] [OCR text](domain-language.md#ocr-text) is stored per page in its original language
- [2] [file_date](domain-language.md#file_date) uses the best available date and records its source
- [4] A video gets metadata and its [provider hash](domain-language.md#provider-hash); it is not downloaded and gets no OCR *(provisional: [open question: videos](open-questions.md#question-videos))*
- [6] [kind](domain-language.md#kind) and [has_text](domain-language.md#has_text) follow the agreed examples *(provisional: [open question: kind rules](open-questions.md#question-kind-rules))*
- [6] Only a [file](domain-language.md#file) of [kind](domain-language.md#kind) document gets a [description](domain-language.md#description)
- [6] A [description](domain-language.md#description) is one English line and keeps proper names verbatim
- [6] [doc_type](domain-language.md#doc_type) always comes from the vocabulary
- [6] A [file](domain-language.md#file) indexed before a [pipeline](domain-language.md#pipeline) step existed gets that step only when the [user](domain-language.md#user) asks for it
- [6] † A step run over [files](domain-language.md#file) already indexed downloads nothing *(new)*

**Duplicates**

- [8] The same [bytes](domain-language.md#bytes) in two [sources](domain-language.md#source) form one [exact](domain-language.md#exact) group
- [8] An [attachment](domain-language.md#attachment) that also exists in Google Drive lands in the same [exact](domain-language.md#exact) group
- [8] A resized or recompressed copy joins the [near](domain-language.md#near) group
- [8] Different photos are not grouped
- [8] The [keeper](domain-language.md#keeper) is suggested from the [user](domain-language.md#user)'s [order of sources](domain-language.md#order-of-sources)
- [8] Inside the winning [source](domain-language.md#source), ties go to the highest resolution, then complete EXIF, then the oldest
- [8] The [user](domain-language.md#user) can change the [keeper](domain-language.md#keeper) of a [duplicate group](domain-language.md#duplicate-group) in the [duplicate report](domain-language.md#duplicate-report)
- [8] A suggested [keeper](domain-language.md#keeper) stays a suggestion until the [user](domain-language.md#user) marks the group [reviewed](domain-language.md#reviewed)
- [8] A new [file](domain-language.md#file) joining a [reviewed](domain-language.md#reviewed) group puts it back to not reviewed, and the [user](domain-language.md#user)'s earlier [keeper](domain-language.md#keeper) stays as the suggestion
- [8] The [duplicate report](domain-language.md#duplicate-report) shows thumbnails and paths side by side
- [8] The [duplicate report](domain-language.md#duplicate-report) refuses a change without valid credentials
- [8] [Files](domain-language.md#file) in a [shared account](domain-language.md#shared-account) are flagged as also belonging to someone else
- [8] † Nothing is ever deleted or moved automatically
- [9] The same photo as JPG in OneDrive and HEIC in iCloud Photos lands in one [near](domain-language.md#near) group

**Collectors**

- [2] The [API](domain-language.md#api) refuses a call without valid credentials
- [9] The same [file](domain-language.md#file) seen by both Macs is one row
- [9] A [collector](domain-language.md#collector) uploads the [bytes](domain-language.md#bytes) of every [file](domain-language.md#file) it reports as new or changed *(new)*
- [9] † A [collector](domain-language.md#collector) interrupted after sending [file records](domain-language.md#file-record) sends them again and nothing is doubled

**E-mail**

- [5] Nothing from a [sender](domain-language.md#sender) on the [blacklist](domain-language.md#blacklist) is indexed, [attachments](domain-language.md#attachment) included
- [5] An [attachment](domain-language.md#attachment) from a [sender](domain-language.md#sender) on the [whitelist](domain-language.md#whitelist) is indexed as a [file](domain-language.md#file) and goes through the same [pipeline](domain-language.md#pipeline)
- [5] A no-reply [sender](domain-language.md#sender) is not taken for [advertisement](domain-language.md#advertisement): an invoice from a whitelisted no-reply sender is indexed
- [5] A picture inside an [e-mail](domain-language.md#e-mail)'s text, such as a logo, is not an [attachment](domain-language.md#attachment)
- [5] An [attachment](domain-language.md#attachment)'s [file_date](domain-language.md#file_date) is the date received
- [5] An [attachment](domain-language.md#attachment)'s [open_link](domain-language.md#open_link) opens its Gmail thread
- [5] An [e-mail](domain-language.md#e-mail) from a [sender](domain-language.md#sender) on the [whitelist](domain-language.md#whitelist) has its body indexed *(provisional: [open question: whitelist and official senders](open-questions.md#question-whitelist-and-official-senders))*
- [5] Nothing from a [sender](domain-language.md#sender) on neither list is indexed *(provisional: [open question: unknown senders](open-questions.md#question-unknown-senders))*
- [5] The [run](domain-language.md#run) summary lists the new [senders](domain-language.md#sender) with a count and the [provider](domain-language.md#provider)'s hints *(provisional: same question)*
- [5] After the [user](domain-language.md#user) puts a [sender](domain-language.md#sender) on the [whitelist](domain-language.md#whitelist), the next [run](domain-language.md#run) indexes that sender's earlier [e-mails](domain-language.md#e-mail) too *(provisional: same question)*
- [5] The first [e-mail](domain-language.md#e-mail) [run](domain-language.md#run) indexes nothing: it lists the [senders](domain-language.md#sender) for the [user](domain-language.md#user) to sort *(provisional: same question)*

**Photos**

- [9] Albums, [persons](domain-language.md#person), favorites and [place](domain-language.md#place) from iCloud Photos are kept
- [10] Photos are found by month
- [10] Photos are found by what they show: "beach" finds a beach photo whose name says nothing

**Privacy**

- [2] Processing a [file](domain-language.md#file) uses local models only
- [2] † OAuth tokens are stored encrypted and every scope is read-only
- [9] † iCloud Photos is read only through osxphotos

**Baseline**

No titles yet. They are written once the figures are ruled:
[open question: baseline figures](open-questions.md#question-baseline-figures).
