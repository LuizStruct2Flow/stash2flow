# How it works

What happens to a file from the moment a source is read until the user finds it
in a search or sees it in the duplicate report. Read this to understand the
app's behaviour; it describes the index, the first of the
[#four-steps](mission.md#four-steps).

## Runs

`#runs`

A [#run](domain-language.md#run) is one pass over one source. The first run of
a source is full. Every later run is incremental: it reads only what changed
since the stored [#cursor](domain-language.md#cursor).

A run only reads. It never writes to a source.

For every run the server records when it started and finished, how many files
were new, changed and vanished, and its errors. A file that fails is recorded
in the run's errors and the run goes on. The user can see a run's state and its
errors.

When a run finishes, a [#summary-notification](domain-language.md#summary-notification)
reports new files, new duplicates and errors. Through which channel it is sent
is open:
[#question-notification-channel](open-questions.md#question-notification-channel).

## Starting a run

`#starting-a-run`

Runs are started by the user, and he can start one at any time. The first run
of a source is always his.

A run starts by itself in one case only: see [#thirty-days](#thirty-days).

## Thirty days

`#thirty-days`

A run starts by itself only when 30 days have passed since that source's last
finished run.

- The 30 days count per source. Running one source does not postpone the
  others.
- Only a finished run moves the date. A run that failed or was interrupted does
  not.
- A source with no finished run does not start by itself.
- On the server the [#scheduler](domain-language.md#scheduler) starts the run.
  On a Mac the system's own scheduler (`launchd`) does, and a Mac that was
  asleep when its run was due runs when it wakes.

Decided by the founder on 3 October 2026.

## Resuming

`#resuming`

The first run of a source goes in batches and can be interrupted. It resumes
where it stopped, from the [#checkpoint](domain-language.md#checkpoint). Photos
are read from the oldest to the newest.

The rules that make this safe:

- The server stores a batch of file records and the position reached in one
  step, then acknowledges. The puller or collector moves on only after the acknowledgement.
- So the cursor and the checkpoint move only when every file record up to them
  is stored.
- A batch delivered twice changes nothing, because file records are stored by
  the file's identity.

## Unchanged files

`#unchanged-files`

A second run with no changes downloads nothing and processes nothing. Whether a
file is unchanged is decided by one rule, applied on the server when the file
record arrives, against what the index already holds:

1. Same [#provider-hash](domain-language.md#provider-hash): unchanged.
2. No provider hash, but same size and modification time: unchanged.
3. Otherwise the sha256 decides. A collector computes it locally; the server
   computes it after fetching the bytes.

A file that shows a newer date but has the same hash is a file already read:
its date is updated and no pipeline step runs again. (Decided by the founder on
3 October 2026.)

A changed file is processed again. An unchanged file whose pipeline steps are
all done costs nothing.

The first run fetches every file once, because the sha256 needs the bytes.
Later runs skip unchanged files by the provider hash.

## Vanished files

`#vanished-files`

A file that is no longer in its source is
[#vanished](domain-language.md#vanished). Its row stays in the index and its
`deleted_at` is set. Nothing is removed.

Whether vanished files show up in search is open:
[#question-vanished-in-search](open-questions.md#question-vanished-in-search).

## Pipeline steps

`#pipeline-steps`

Every file goes through the same [#pipeline](domain-language.md#pipeline), in
this order:

1. **Discovery.** Pullers and collectors list their sources and send
   [#file-record](domain-language.md#file-record)s to the server.
2. **Unchanged?** The rule in [#unchanged-files](#unchanged-files). An
   unchanged file stops here.
3. **Bytes.** The file's bytes are brought to the server and kept as its
   [#local-copy](principles.md#local-copy).
4. **Hashes.** md5 and sha256 on the bytes; the provider hash is stored too.
   For an image, the [#phash](domain-language.md#phash); for a PDF, the phash
   of its rendered first page.
5. **Metadata.**
   - Images: the date taken, the coordinates, the camera, the dimensions.
   - PDFs: the creation date, the program that made it (which identifies a
     scanner), the page count.
   - Photos from iCloud Photos: the library's id, date, place, albums, persons
     and favorites.
   - The raw metadata of the source is kept as it is.
   - From these the [#file_date](domain-language.md#file_date) is chosen: the
     best available date, with a note of where it came from.
6. **Text.** A PDF with a [#text-layer](domain-language.md#text-layer) is not
   sent to OCR. Otherwise the pages are rendered and read. The
   [#ocr-text](domain-language.md#ocr-text) is stored per page in its original
   language. Exactly which files are read is open:
   [#question-which-files-get-ocr](open-questions.md#question-which-files-get-ocr).
7. **Kind.** [#has_text](domain-language.md#has_text) is set from the amount of
   OCR text, and the [#kind](domain-language.md#kind) of the file is decided.
   The exact rules are open:
   [#question-kind-rules](open-questions.md#question-kind-rules).
8. **Description.** Only for a file of kind `document`. A local model writes
   one English line from the OCR text, keeping proper names verbatim. It also
   extracts the [#doc_date](domain-language.md#doc_date), the
   [#doc_type](domain-language.md#doc_type), the
   [#person](domain-language.md#person) and the
   [#issuer](domain-language.md#issuer). The doc_type always comes from the
   vocabulary: `id`, `tax`, `invoice`, `contract`, `certificate`,
   `bank_statement`, `insurance`, `medical`, `receipt`, `letter`, `other`.
9. **Embeddings.** One [#embedding](domain-language.md#embedding) for each
   photo, so a query like "beach" finds it. One over the OCR text, with a model
   that works across languages, so English words find a document written in
   another language.
10. **Duplicates.** The file is grouped with the files that are the same. See
    [#duplicates](#duplicates).

**Videos** get their metadata and no OCR. They are not fetched: only their
provider hash is stored, so the same video at two different providers is not
recognised as an exact duplicate. Whether videos are copied to the server after
all, which would close that gap, is open:
[#question-videos](open-questions.md#question-videos).

Every step that uses a model uses a local one:
[#local-models-only](principles.md#local-models-only). Which models is open:
[#question-which-models](open-questions.md#question-which-models).

## Steps added later

`#steps-added-later`

The pipeline grows over time: a step may be added when files are already
indexed. So:

- Each file records which steps it has completed and, for a step done by a
  model, which model. This record has no agreed word yet:
  [#question-name-for-pipeline-progress](open-questions.md#question-name-for-pipeline-progress).
- An ordinary run processes a file only when it is new or changed.
- When a step or a model is added, existing files get it **only when the user
  asks**.
- Nothing is downloaded a second time for this. Description and text embedding
  need only the stored OCR text; everything else reads the local copy.

## What the index holds

`#what-the-index-holds`

| About | What is kept |
|---|---|
| Each source | location, account, reader, cursor, checkpoint, whether it is enabled, when its last run finished, its rank in the order of sources |
| Each file | its identity; path, name and ext; size and modification time; file_date and where it came from; the hashes; kind and has_text; description, doc_type, doc_date, person, issuer; coordinates, dimensions, page count; open_link; for an attachment the sender, subject and thread; the raw metadata; which machine sent it; its duplicate group; when it was first and last seen, and when it vanished |
| Text | the OCR text per page, searchable without accents and tolerant of misreadings |
| Embeddings | per file, with the name of the model that made them |
| Each duplicate group | exact or near, the keeper, reviewed or not |
| Each run | start, finish, counts of new, changed and vanished files, errors |
| The user's choices | the order of sources, keepers and reviewed groups, the whitelist and the blacklist |
| The baseline | see [#measuring-before-and-after](mission.md#measuring-before-and-after) |

Whether a file can have several persons is open:
[#question-several-persons](open-questions.md#question-several-persons).

## Duplicates

`#duplicates`

Files that are the same form a
[#duplicate-group](domain-language.md#duplicate-group), across all sources and
accounts.

| Group | Meaning | Example |
|---|---|---|
| [#exact](domain-language.md#exact) | the same bytes | an attachment that also exists in a cloud drive |
| [#near](domain-language.md#near) | the same image at another resolution or in another format | a photo and the copy a messenger compressed; a HEIC photo and its exported JPG |

- Near is decided by the distance between two phash values, against a threshold
  that is configurable.
- Different photos are not grouped.
- A group keeps its id when files join it.
- Files in a [#shared-account](domain-language.md#shared-account) are flagged
  as also belonging to someone else.
- Near duplicates across sources are expected from the first day, for example
  when a cloud drive holds a partial copy of a photo library.

Open points: which hash decides exact
([#question-which-hash-decides-exact](open-questions.md#question-which-hash-decides-exact)),
whether a file can be in two groups at once
([#question-one-group-per-file](open-questions.md#question-one-group-per-file)),
and near matching of PDFs
([#question-near-matching-pdfs](open-questions.md#question-near-matching-pdfs)).

## Choosing the keeper

`#choosing-the-keeper`

The user's [#order-of-sources](domain-language.md#order-of-sources) decides the
[#keeper](domain-language.md#keeper).

1. The user sets the order of his sources once.
2. In each duplicate group, the file from the highest-ranked source is
   suggested as the keeper.
3. If that source has several files in the group, the tie goes to the highest
   resolution, then to complete photo metadata, then to the oldest.
4. The user can change the keeper of any group.
5. Nothing counts as chosen until the user marks the group
   [#reviewed](domain-language.md#reviewed).
6. When a new file joins a group he already reviewed, the group goes back to
   not reviewed, and his earlier keeper stays as the suggestion.

The order of sources is stored in the database with the sources, so the backup
covers it.

Decided by the founder on 3 October 2026.

## Reviewing duplicates

`#reviewing-duplicates`

The [#duplicate-report](domain-language.md#duplicate-report) is a web page,
opened with `stash dups --report`. It shows each group with thumbnails and
paths side by side, the suggested keeper, and the flag for files in a shared
account. The thumbnails are kept on the server.

The page takes two changes from the user: the keeper of a group, and reviewed.
It refuses a change without valid credentials.

The report only reports. Nothing is deleted or moved. Whether non-keepers may
be moved aside is open:
[#question-moving-non-keepers](open-questions.md#question-moving-non-keepers).
How the report relates to the coming frontend is open too:
[#question-duplicate-report-and-frontend](open-questions.md#question-duplicate-report-and-frontend).

## Search

`#search`

Search is served by the API and used through a thin command line, `stash`.

| Command | Finds |
|---|---|
| `stash search "<words>"` | files by their text |
| `stash search --doc-type tax --person <name> --from 2005 --to 2015` | documents by type, person and date range |

How text search behaves:

- A scan with no text layer is found by its OCR text.
- Accents are ignored: "certidao" finds "Certidão".
- OCR misreadings are tolerated: "recibo" finds a page read as "rec1bo".
- A query in another language finds the document: English words find a
  Portuguese receipt. This combines the text match with the embedding of the
  OCR text.
- Every entry in the answer carries an
  [#open_link](domain-language.md#open_link).

Open points: which date the date range filters on
([#question-date-filter](open-questions.md#question-date-filter)) and whether
vanished files are shown
([#question-vanished-in-search](open-questions.md#question-vanished-in-search)).

## Finding photos

`#finding-photos`

| Command | Finds |
|---|---|
| `stash photos --date 2024-07` | photos by month |
| `stash photos --query "beach"` | photos by what they show, even when the name says nothing |

Albums, persons, favorites and place from iCloud Photos are kept with each
photo. Place is stored but not searchable in the index item.
