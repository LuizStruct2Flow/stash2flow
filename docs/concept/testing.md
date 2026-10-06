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

The feature files use only the words in the
[domain language](domain-language.md).

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
for the [ledger](domain-language.md#ledger) includes a batch delivered
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
- invented [senders](domain-language.md#sender), with made-up
  [e-mails](domain-language.md#e-mail): an invoice and an offer from the same
  invented online shop, an invoice that carries an unsubscribe header, an
  e-mail with an attached PDF whose
  [mail_label](domain-language.md#mail_label) says promotions, a personal
  e-mail, and [spam](domain-language.md#spam) whose mail_label says spam;
- among those invented [senders](domain-language.md#sender): one the
  [user](domain-language.md#user) has written to, one he marked as
  [trusted](domain-language.md#trusted), a
  [rejected sender](domain-language.md#rejected-sender) and an
  [undecided sender](domain-language.md#undecided-sender);
- a made-up [e-mail](domain-language.md#e-mail) whose text points at a remote
  image and a link, and a made-up PDF that carries a script, both harmless;
- a made-up word-processor file and a made-up spreadsheet file with invented
  text, one of them carrying a harmless macro;
- a made-up archive, and a made-up file whose file type the app does not know.

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
4. The same [asset](domain-language.md#asset) seen by two Macs is one row, not
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
- *new* means the founder has not reviewed the title yet.

**Search**

- [2] A [scan](domain-language.md#scan) with no [text layer](domain-language.md#text-layer) is found by its [OCR text](domain-language.md#ocr-text)
- [2] Search ignores accents: "certidao" finds "Certidão"
- [2] Search tolerates OCR misreadings: "recibo" finds a page read as "rec1bo"
- [2] Every [match](domain-language.md#match) carries a [source_link](domain-language.md#source_link)
- [3] A [vanished](domain-language.md#vanished) [asset](domain-language.md#asset) is left out of the answer, and the answer says how many were left out
- [3] With the flag, a [vanished](domain-language.md#vanished) [asset](domain-language.md#asset) is shown in the answer *(new)*
- [6] Search filters by [doc_type](domain-language.md#doc_type)
- [6] Search filters by [person](domain-language.md#person), and a document with two persons is found under each of them
- [6] Search filters documents by date range on the [doc_date](domain-language.md#doc_date) *(new)*
- [6] A document with no [doc_date](domain-language.md#doc_date) is found in a date range by its [asset_date](domain-language.md#asset_date) *(new)*
- [7] A query in another language finds the document: English words find a Portuguese receipt

**Runs**

- [2] The [user](domain-language.md#user) can start a [run](domain-language.md#run) at any time
- [2] † A run never writes to a [source](domain-language.md#source)
- [2] The first [run](domain-language.md#run) of a [source](domain-language.md#source) reports the source's total size before it downloads anything *(new)*
- [2] † The [server](domain-language.md#server) keeps a [local copy](domain-language.md#local-copy) of every [asset](domain-language.md#asset) it indexes fully *(new)*
- [2] † The same [bytes](domain-language.md#bytes) arriving from two [sources](domain-language.md#source) are kept once in the [stash](domain-language.md#stash) *(new)*
- [2] † File names are stored in NFC
- [3] An interrupted [run](domain-language.md#run) resumes where it stopped
- [3] A second [run](domain-language.md#run) with no changes downloads nothing and processes nothing
- [3] An [asset](domain-language.md#asset) that shows a newer date but has the same hash is recognised as already read and is not processed again
- [3] A changed [asset](domain-language.md#asset) is processed again
- [3] An [asset](domain-language.md#asset) that [vanished](domain-language.md#vanished) from its [source](domain-language.md#source) keeps its row and gets deleted_at
- [3] An [asset](domain-language.md#asset) that fails is recorded in the [run](domain-language.md#run)'s errors and the run goes on
- [3] The [user](domain-language.md#user) can see a [run](domain-language.md#run)'s state and its errors
- [3] † A [source](domain-language.md#source)'s [cursor](domain-language.md#cursor) moves only when every [asset record](domain-language.md#asset-record) up to it is stored
- [4] A folder on a network storage device is [fetched](domain-language.md#fetching) by the [server](domain-language.md#server) like any other [source](domain-language.md#source) *(new)*
- [9] A full [run](domain-language.md#run) over all [sources](domain-language.md#source) finishes
- [11] A [run](domain-language.md#run) starts by itself only when 30 days have passed since the [source](domain-language.md#source)'s last finished run
- [11] A [source](domain-language.md#source) with no finished [run](domain-language.md#run) does not start by itself
- [11] A [run](domain-language.md#run) that failed or was interrupted does not move the date
- [11] Running one [source](domain-language.md#source) does not postpone the others
- [11] A Mac that was asleep when its [run](domain-language.md#run) was due runs when it wakes
- [11] A [summary notification](domain-language.md#summary-notification) reports new [assets](domain-language.md#asset), new [duplicates](domain-language.md#duplicate) and errors

**Pipeline**

- [2] A PDF with a [text layer](domain-language.md#text-layer) is not sent to OCR
- [2] Every image and every PDF without a [text layer](domain-language.md#text-layer) gets OCR
- [2] [OCR text](domain-language.md#ocr-text) is stored per page in its original language
- [2] The text of an office document is read, and the document is found by it *(new)*
- [2] An archive is not opened: its name, size and hash are recorded, and it is listed for the [user](domain-language.md#user) as not covered *(new)*
- [2] Of a program, or of a file whose file type the app does not know, only the name, size and hash are recorded, and it is never read *(new)*
- [2] A file beyond the [user](domain-language.md#user)'s limit on size or on the number of pages is not read *(new)*
- [2] [asset_date](domain-language.md#asset_date) uses the best available date and records its source
- [4] A video gets metadata and its [provider hash](domain-language.md#provider-hash) and never gets OCR; until the [user](domain-language.md#user) decides about videos it is not downloaded *(new)*
- [6] [kind](domain-language.md#kind) and [has_text](domain-language.md#has_text) follow the agreed examples: a screenshot and a photo, enough text and too little *(new)*
- [6] Only an [asset](domain-language.md#asset) of [kind](domain-language.md#kind) document gets a [description](domain-language.md#description)
- [6] A [description](domain-language.md#description) is one English line and keeps proper names verbatim
- [6] [doc_type](domain-language.md#doc_type) always comes from the vocabulary
- [6] An [asset](domain-language.md#asset) indexed before a [pipeline](domain-language.md#pipeline) step existed gets that step only when the [user](domain-language.md#user) asks for it
- [6] † A step run over [assets](domain-language.md#asset) already indexed downloads nothing *(new)*

**Duplicates**

- [8] The same [bytes](domain-language.md#bytes) in two [sources](domain-language.md#source) form one [exact](domain-language.md#exact) group
- [8] An [attachment](domain-language.md#attachment) that also exists in Google Drive lands in the same [exact](domain-language.md#exact) group
- [8] The same [bytes](domain-language.md#bytes) on a network storage device and on its copy form [exact](domain-language.md#exact) [duplicates](domain-language.md#duplicate), and the [order of sources](domain-language.md#order-of-sources) decides the [keeper](domain-language.md#keeper) *(new)*
- [8] A resized or recompressed copy joins the [near](domain-language.md#near) group
- [8] Different photos are not grouped
- [8] An [asset](domain-language.md#asset) is in one [duplicate group](domain-language.md#duplicate-group) only: assets showing the same image are one group, [exact](domain-language.md#exact) when all [bytes](domain-language.md#bytes) match, otherwise [near](domain-language.md#near) *(new)*
- [8] † Two [assets](domain-language.md#asset) are [exact](domain-language.md#exact) [duplicates](domain-language.md#duplicate) when their [sha256](domain-language.md#md5-and-sha256) is the same *(new)*
- [8] The [keeper](domain-language.md#keeper) is suggested from the [user](domain-language.md#user)'s [order of sources](domain-language.md#order-of-sources)
- [8] Inside the winning [source](domain-language.md#source), ties go to the highest resolution, then complete photo metadata as in the agreed examples, then the oldest *(new)*
- [8] The [user](domain-language.md#user) can change the [keeper](domain-language.md#keeper) of a [duplicate group](domain-language.md#duplicate-group) in the [duplicate report](domain-language.md#duplicate-report)
- [8] A suggested [keeper](domain-language.md#keeper) stays a suggestion until the [user](domain-language.md#user) marks the group [reviewed](domain-language.md#reviewed)
- [8] A new [asset](domain-language.md#asset) joining a [reviewed](domain-language.md#reviewed) group puts it back to not reviewed, and the [user](domain-language.md#user)'s earlier [keeper](domain-language.md#keeper) stays as the suggestion
- [8] The [duplicate report](domain-language.md#duplicate-report) shows thumbnails and paths side by side
- [8] The [duplicate report](domain-language.md#duplicate-report) refuses a change without valid credentials
- [8] [Assets](domain-language.md#asset) in a [shared account](domain-language.md#shared-account) are flagged as also belonging to someone else
- [8] † The index deletes nothing and moves nothing
- [9] The same photo as JPG in OneDrive and HEIC in iCloud Photos lands in one [near](domain-language.md#near) group

**Collectors**

- [2] The [API](domain-language.md#api) refuses a call without valid credentials
- [2] † Each client of the [API](domain-language.md#api) authenticates with its own token: a [collector](domain-language.md#collector), the command line and the browser *(new)*
- [2] † The [API](domain-language.md#api) is served over HTTPS only *(new)*
- [9] The same [asset](domain-language.md#asset) seen by both Macs is one row
- [9] [Asset records](domain-language.md#asset-record) from a second [collector](domain-language.md#collector) for the same [source](domain-language.md#source) update the same rows, and [collected_by](domain-language.md#collected_by) records which machine sent them *(new)*
- [9] A [collector](domain-language.md#collector) uploads the [bytes](domain-language.md#bytes) of every [asset](domain-language.md#asset) it reports as new or changed *(new)*
- [9] † A [collector](domain-language.md#collector) interrupted after sending [asset records](domain-language.md#asset-record) sends them again and nothing is doubled

**E-mail**

- [5] An [e-mail](domain-language.md#e-mail) whose [mail_label](domain-language.md#mail_label) says promotions is an [advertisement](domain-language.md#advertisement) *(new)*
- [5] An [e-mail](domain-language.md#e-mail) that carries an unsubscribe header and whose [mail_label](domain-language.md#mail_label) does not say promotions is not an [advertisement](domain-language.md#advertisement) *(new)*
- [5] An invoice that carries an unsubscribe header, from a [trusted](domain-language.md#trusted) [sender](domain-language.md#sender), is indexed fully *(new)*
- [5] An [e-mail](domain-language.md#e-mail) with an attached PDF is not [blacklisted](domain-language.md#blacklist) by its [mail_label](domain-language.md#mail_label) alone *(new)*
- [5] An [e-mail](domain-language.md#e-mail) whose [mail_label](domain-language.md#mail_label) says spam is [spam](domain-language.md#spam) and is [blacklisted](domain-language.md#blacklist) *(new)*
- [5] An [e-mail](domain-language.md#e-mail) from a [rejected sender](domain-language.md#rejected-sender) is [spam](domain-language.md#spam) and is [blacklisted](domain-language.md#blacklist) *(new)*
- [5] An [advertisement](domain-language.md#advertisement) is recorded with its [sender](domain-language.md#sender), subject, date and [mail_label](domain-language.md#mail_label) only: no [local copy](domain-language.md#local-copy), no [description](domain-language.md#description), no other [pipeline](domain-language.md#pipeline) step *(new)*
- [5] [Spam](domain-language.md#spam) is recorded with its [sender](domain-language.md#sender), subject, date and [mail_label](domain-language.md#mail_label) only: no [local copy](domain-language.md#local-copy), no [description](domain-language.md#description) *(new)*
- [5] An [advertisement](domain-language.md#advertisement) that arrived less than one week ago is neither [whitelisted](domain-language.md#whitelist) nor [blacklisted](domain-language.md#blacklist) *(new)*
- [5] An [advertisement](domain-language.md#advertisement) that arrived more than one week ago is [blacklisted](domain-language.md#blacklist) *(new)*
- [5] An [e-mail](domain-language.md#e-mail) from a [trusted](domain-language.md#trusted) [sender](domain-language.md#sender) that is neither [advertisement](domain-language.md#advertisement) nor [spam](domain-language.md#spam) is indexed fully: its [message body](domain-language.md#message-body) and its [attachments](domain-language.md#attachment) *(new)*
- [5] An [attachment](domain-language.md#attachment) of an [e-mail](domain-language.md#e-mail) that is indexed fully is indexed as an [asset](domain-language.md#asset) and goes through the same [pipeline](domain-language.md#pipeline) *(new)*
- [5] The same [trusted](domain-language.md#trusted) [sender](domain-language.md#sender) can send an invoice that is indexed fully and an offer that is an [advertisement](domain-language.md#advertisement) *(new)*
- [5] A no-reply [sender](domain-language.md#sender) is not taken for [advertisement](domain-language.md#advertisement): an invoice from a [trusted](domain-language.md#trusted) no-reply sender is indexed fully *(new)*
- [5] A picture inside an [e-mail](domain-language.md#e-mail)'s text, such as a logo, is not an [attachment](domain-language.md#attachment)
- [5] An [attachment](domain-language.md#attachment)'s [asset_date](domain-language.md#asset_date) is the date received
- [5] An [attachment](domain-language.md#attachment)'s [source_link](domain-language.md#source_link) opens its Gmail thread
- [5] A personal [e-mail](domain-language.md#e-mail) from a [sender](domain-language.md#sender) who is a [person](domain-language.md#person) on the [user](domain-language.md#user)'s list is [whitelisted](domain-language.md#whitelist) by default
- [5] † A [blacklisted](domain-language.md#blacklist) [e-mail](domain-language.md#e-mail) stays in its mailbox: the index only records the verdict *(new)*
- [5] The [run](domain-language.md#run) summary counts the [advertisements](domain-language.md#advertisement), the [spam](domain-language.md#spam) and the [blacklisted](domain-language.md#blacklist) [assets](domain-language.md#asset) *(new)*

**Trust and isolation**

- [2] An [asset](domain-language.md#asset) from the [user](domain-language.md#user)'s own drives is read fully *(new)*
- [2] † A script inside a PDF is never run *(new)*
- [2] † A macro in an office document is never run *(new)*
- [2] † The [guardian](domain-language.md#guardian) cannot reach the network while it reads an [asset](domain-language.md#asset) *(new)*
- [2] † The [guardian](domain-language.md#guardian) cannot reach the [providers](domain-language.md#provider)' access tokens or the database while it reads an [asset](domain-language.md#asset) *(new)*
- [9] † On a Mac the [guardian](domain-language.md#guardian) cannot reach the network while it reads an [asset](domain-language.md#asset) *(new)*
- [5] A [sender](domain-language.md#sender) the [user](domain-language.md#user) has written to is [trusted](domain-language.md#trusted) *(new)*
- [5] A [sender](domain-language.md#sender) the [user](domain-language.md#user) marked as [trusted](domain-language.md#trusted) is trusted *(new)*
- [5] An [e-mail](domain-language.md#e-mail) from an [undecided sender](domain-language.md#undecided-sender) is not read: its sender, subject, date and [mail_label](domain-language.md#mail_label) are recorded, and the sender is listed for the [user](domain-language.md#user) *(new)*
- [5] The first [run](domain-language.md#run) over a mailbox starts by showing the [user](domain-language.md#user) his [senders](domain-language.md#sender), those he has written to already [trusted](domain-language.md#trusted) *(new)*
- [5] The [user](domain-language.md#user) decides once per [sender](domain-language.md#sender), not per [e-mail](domain-language.md#e-mail), and the sender is not listed again *(new)*
- [5] Once an [undecided sender](domain-language.md#undecided-sender) is [trusted](domain-language.md#trusted), the next [run](domain-language.md#run) reads its recorded [e-mails](domain-language.md#e-mail) *(new)*
- [5] An [e-mail](domain-language.md#e-mail) from a [rejected sender](domain-language.md#rejected-sender) is not read *(new)*
- [5] An [e-mail](domain-language.md#e-mail) from a [trusted](domain-language.md#trusted) [sender](domain-language.md#sender) whose [mail_label](domain-language.md#mail_label) says promotions is still an [advertisement](domain-language.md#advertisement) and is not read *(new)*
- [5] An [e-mail](domain-language.md#e-mail) from a [trusted](domain-language.md#trusted) [sender](domain-language.md#sender) whose [mail_label](domain-language.md#mail_label) says spam is still [spam](domain-language.md#spam) and is not read *(new)*
- [5] An [e-mail](domain-language.md#e-mail) with an attached PDF whose [mail_label](domain-language.md#mail_label) says promotions, from a [trusted](domain-language.md#trusted) [sender](domain-language.md#sender), is read like any other e-mail from that sender *(new)*
- [5] An [e-mail](domain-language.md#e-mail) with an attached PDF whose [mail_label](domain-language.md#mail_label) says promotions, from an [undecided sender](domain-language.md#undecided-sender), is only recorded *(new)*
- [5] An [e-mail](domain-language.md#e-mail) from an [undecided sender](domain-language.md#undecided-sender) is not [blacklisted](domain-language.md#blacklist) for that reason *(new)*
- [5] † Reading an [e-mail](domain-language.md#e-mail) loads nothing from the internet: no remote image and no link *(new)*
- [5] The [run](domain-language.md#run) summary lists the [undecided senders](domain-language.md#undecided-sender) that wait for the [user](domain-language.md#user)'s decision *(new)*

**Photos**

- [9] Albums, [persons](domain-language.md#person), favorites and [place](domain-language.md#place) from iCloud Photos are kept
- [9] A photo from the [user](domain-language.md#user)'s phone is [whitelisted](domain-language.md#whitelist) by default
- [10] Photos are found by month, by their [asset_date](domain-language.md#asset_date) *(new)*
- [10] Photos are found by what they show: "beach" finds a beach photo whose name says nothing

**Privacy**

- [2] Processing an [asset](domain-language.md#asset) uses local models only
- [2] † OAuth tokens are stored encrypted and every scope is read-only
- [9] † iCloud Photos is [fetched](domain-language.md#fetching) only through osxphotos

**Baseline**

- [2] The first full [run](domain-language.md#run) of a [source](domain-language.md#source) records in the [baseline](domain-language.md#baseline) how many [assets](domain-language.md#asset) and how many [bytes](domain-language.md#bytes) the source holds *(new)*
- [3] † A later [run](domain-language.md#run) leaves the [baseline](domain-language.md#baseline) unchanged *(new)*
- [5] The [baseline](domain-language.md#baseline) counts the [blacklisted](domain-language.md#blacklist) [assets](domain-language.md#asset) per [source](domain-language.md#source), [advertisements](domain-language.md#advertisement) included *(new)*
- [8] The [baseline](domain-language.md#baseline) counts the [exact](domain-language.md#exact) [duplicates](domain-language.md#duplicate) and the [near](domain-language.md#near) duplicates per [source](domain-language.md#source) *(new)*
- [8] The [baseline](domain-language.md#baseline) records, over all [sources](domain-language.md#source), the number of sources an [asset](domain-language.md#asset) is found in *(new)*

## Clean-up scenario titles

`#clean-up-scenario-titles`

**These are not part of the index.** They belong to clean-up
([FEATURE-002](../backlog/BACKLOG.md)), which is parked, so they carry no slice
number and no slice of the index makes them green. They are kept here so the
wording of the [quarantine](domain-language.md#quarantine) is reviewed with the
rest.

- An [asset](domain-language.md#asset) [blacklisted](domain-language.md#blacklist) by a rule is moved to the [quarantine](domain-language.md#quarantine)
- Moving an [asset](domain-language.md#asset) [blacklisted](domain-language.md#blacklist) by a rule to the [quarantine](domain-language.md#quarantine) needs no go for each asset
- The [user](domain-language.md#user) can look through the [quarantine](domain-language.md#quarantine)
- The [quarantine](domain-language.md#quarantine) shows the [assets](domain-language.md#asset) of all [sources](domain-language.md#source) in one place *(new)*
- The [user](domain-language.md#user) can restore an [asset](domain-language.md#asset) from the [quarantine](domain-language.md#quarantine)
- The [user](domain-language.md#user) can delete an [asset](domain-language.md#asset) in the [quarantine](domain-language.md#quarantine) permanently
- An [asset](domain-language.md#asset) that stayed in the [quarantine](domain-language.md#quarantine) for 30 days is deleted permanently
- An [asset](domain-language.md#asset) restored from the [quarantine](domain-language.md#quarantine) is not deleted
- An [asset](domain-language.md#asset) worth keeping is removed from a [source](domain-language.md#source) only when verified copies exist
- A [non-keeper](domain-language.md#non-keeper) reaches the [quarantine](domain-language.md#quarantine) even when its [keeper](domain-language.md#keeper) is [whitelisted](domain-language.md#whitelist) *(provisional: [open question: whitelisted asset in the quarantine](open-questions.md#question-whitelisted-asset-in-the-quarantine))*
