# Domain language

The agreed words of stash2flow, each with its meaning. Read this before writing
or reviewing anything: code, tests, feature files, logs, the command line and
the API use exactly these words. The words are the founder's.

Each word has its own heading. The last two sections list the words that are
deliberately not used, and the concepts that still have no agreed word.

## Agreed words only

`#agreed-words-only`

- Code, tests, feature files, logs, the command line and the [API](#api) use exactly
  the words in this document.
- A concept without an agreed word is not built until it has one.
- Nobody but the founder adds a word. A missing word is raised as a question to
  him. Until he answers, the concept is described in plain language.

## Language of the app

`#language-of-the-app`

- Code, command line, [API](#api), comments, logs and the fields the app generates
  ([description](#description), [doc_type](#doc_type), [kind](#kind)) are in **English**.
- Text read from a document is stored **as it is**, in its original language.
- Proper names of documents and institutions stay verbatim inside an English
  description.
- Search must match across languages and ignore accents.

## The app and who uses it

### User

`#user`

The person who runs the app and makes its choices: the [order of sources](#order-of-sources), the
[keeper](#keeper), the [whitelist](#whitelist) and [blacklist](#blacklist), starting a [run](#run).

### Server

`#server`

The one local machine that runs the database, the [API](#api), the [pullers](#puller), the [workers](#worker)
and the [scheduler](#scheduler). It also keeps the local copies of the [files](#file).

### API

`#api`

What the [server](#server) serves to its clients: the [collectors](#collector), the command line and the
browser. Taking [file records](#file-record) in is one part of the API.

### Worker

`#worker`

A [server](#server) process that reads text from pages, computes [embeddings](#embedding) or writes
[descriptions](#description).

### Scheduler

`#scheduler`

What starts a [source](#source)'s [run](#run) by itself, 30 days after its last finished run.

## Where files come from

### Source

`#source`

One configured place [files](#file) come from: a [location](#location) plus an [account](#account), read by one
[reader](#reader). Example: one Google Drive of one account is a source; the mailbox of the
same account is another.

### Location

`#location`

Which kind of place a [source](#source) is. It is an open list, with one value per source
adapter. Shipped: `onedrive`, `gdrive`, `icloud_drive`, `icloud_photos`,
`email`.

### Account

`#account`

Whose login the [source](#source) is read with.

### Shared account

`#shared-account`

An [account](#account) that belongs to more than one person. Its [files](#file) are flagged as also
belonging to someone else, so the [user](#user) never treats them as his alone.

### Reader

`#reader`

The machine that reads a [source](#source): the [server](#server), or a Mac that runs a [collector](#collector).
Example: a cloud drive's reader is the server; a photo library that only a Mac
can open has that Mac as its reader.

### Order of sources

`#order-of-sources`

The [user](#user)'s ranking of his [sources](#source). In a [duplicate group](#duplicate-group), the highest-ranked
source gives the [keeper](#keeper). What is ranked is a source, not a [location](#location).

### Provider

`#provider`

The company's [API](#api) behind a [location](#location). Example: the provider behind `gdrive` is
Google's Drive API.

### Puller

`#puller`

The program on the [server](#server) that reads one cloud [source](#source) through its [provider](#provider).

### Collector

`#collector`

The program on a Mac that reads the [sources](#source) that need macOS. A [puller](#puller) and a
collector are different programs.

### collected_by

`#collected_by`

Which machine sent a [file record](#file-record). It is kept for diagnostics only and is never
part of a file's identity.

## Files

### File

`#file`

The unit that is indexed: one row. It is identified by its [location](#location), its
[account](#account) and its [source_file_id](#source_file_id). A document, a photo, an [attachment](#attachment) and an
indexed [message body](#message-body) are all files.

### File record

`#file-record`

What a [puller](#puller) or a [collector](#collector) sends about one [file](#file).

### source_file_id

`#source_file_id`

The [file](#file)'s id inside its [source](#source). Example: the provider's item id, or the id a
photo has in the photo library.

### Bytes

`#bytes`

What a [file](#file) consists of. The word is always bytes, never "content".

### ext

`#ext`

The [file](#file)'s extension, such as PDF or JPG.

### Kind

`#kind`

What sort of [file](#file) it is: `document`, `photo`, `screenshot`, `video` or `other`.
"Document" and "photo" are kinds of a file, not units of their own.

### Scan

`#scan`

A scanned paper, and nothing else. One pass over a [source](#source) is a [run](#run), not a scan.

### source_link

`#source_link`

The link that opens the [file](#file) in its [source](#source). Example: the web address of a
file in a cloud drive, or the link to an e-mail's thread. It does not point at
the [local copy](principles.md#local-copy) on the [server](#server).

### Place

`#place`

Where a photo was taken. Not to be confused with [location](#location), which is the kind of
[source](#source).

### file_date

`#file_date`

The best available date of the [file](#file). `file_date_source` says where it came
from: the photo's own data, the PDF's creation date, the modification time, the
photo library, or the date an e-mail was received.

## Mailboxes

### E-mail

`#e-mail`

One message in a mailbox.

### Sender

`#sender`

Who an [e-mail](#e-mail) comes from.

### Whitelist

`#whitelist`

The [senders](#sender), kept by the [user](#user), whose [e-mails](#e-mail) are indexed.

### Blacklist

`#blacklist`

The [senders](#sender), kept by the [user](#user), from whom nothing is indexed.

### Advertisement

`#advertisement`

An [e-mail](#e-mail) the [user](#user) does not want indexed. It is told by its [sender](#sender) being on the
[blacklist](#blacklist), never by a no-reply address.

### Attachment

`#attachment`

A PDF or an image attached to an [e-mail](#e-mail). It is indexed as a [file](#file). A picture
inside the e-mail's text, such as a logo, is not an attachment.

### Message body

`#message-body`

The text of an [e-mail](#e-mail). Which bodies are indexed is open:
[open question: whitelist and official senders](open-questions.md#question-whitelist-and-official-senders).

### Official sender and keyword

`#official-sender-and-keyword`

Two earlier lists that said which [message bodies](#message-body) are indexed: senders that are
official institutions, and words to look for. Whether they remain next to the
[whitelist](#whitelist) is the same open question as for the message body.

## Runs

### Run

`#run`

One pass over a [source](#source). The first run is full; later runs are incremental and
read only what changed.

### Cursor

`#cursor`

The stored position in a [source](#source)'s change feed at its [provider](#provider). An incremental
[run](#run) starts from it.

### Checkpoint

`#checkpoint`

How far an interrupted first [run](#run) got, stored per [source](#source). It is not the same as
the [cursor](#cursor).

### Vanished

`#vanished`

A [file](#file) that is no longer in its [source](#source). The row stays, and its `deleted_at` is
set. The word is vanished, because the app never deletes.

### Summary notification

`#summary-notification`

The message sent when a [run](#run) finishes.

### Baseline

`#baseline`

The figures recorded at the first full [run](#run) of a [source](#source) and kept unchanged: what
the user had before organizing and cleaning up.

## The pipeline

### Pipeline

`#pipeline`

The steps every [file](#file) goes through.

### Discovery

`#discovery`

The [pipeline](#pipeline) step that lists a [source](#source) and sends [file records](#file-record).

### Provider hash

`#provider-hash`

A hash the [provider](#provider) reports for a [file](#file). It is used to see that a file is
unchanged without fetching its [bytes](#bytes).

### md5 and sha256

`#md5-and-sha256`

Hashes computed on the [file](#file)'s [bytes](#bytes).

### phash

`#phash`

The perceptual hash: a hash of what an image looks like, so the same image at
another resolution or format gives a close value.

### Text layer

`#text-layer`

Text already inside a PDF. It is used instead of OCR.

### OCR text

`#ocr-text`

Text read from a page, stored per page in its original language.

### has_text

`#has_text`

Whether the [file](#file) has enough [OCR text](#ocr-text) to count as having text.

### Description

`#description`

One English line about a [file](#file) of [kind](#kind) `document`.

### doc_type

`#doc_type`

What type of document it is, from a fixed English vocabulary such as `tax` or
`invoice`. On the command line the flag is `--doc-type`.

### doc_date

`#doc_date`

The date printed on the document.

### Person

`#person`

Who the [file](#file) is about or shows, from a list the [user](#user) keeps. The same word is
used for a person on a document and a person recognised in a photo.

### Issuer

`#issuer`

The institution that issued the document.

### Embedding

`#embedding`

A vector for a photo or for [OCR text](#ocr-text). It lets a search find things by meaning.

## Duplicates

### Duplicate

`#duplicate`

A [file](#file) that is the same as another file. The word is always written out.
`dups` exists only as the name of a command.

### Duplicate group

`#duplicate-group`

[Files](#file) that are the same. A group is [exact](#exact) or [near](#near).

### Exact

`#exact`

The same [bytes](#bytes).

### Near

`#near`

The same image at another resolution or in another format. The word is used
only for [duplicates](#duplicate).

### Keeper

`#keeper`

The [file](#file) suggested to keep in a [duplicate group](#duplicate-group).

### Non-keeper

`#non-keeper`

Every other [file](#file) in the [group](#duplicate-group).

### Reviewed

`#reviewed`

Set by the [user](#user) on a [duplicate group](#duplicate-group). Until then the [keeper](#keeper) is only a
suggestion.

### Duplicate report

`#duplicate-report`

The web page that shows [duplicate groups](#duplicate-group) with thumbnails side by side, where
the [user](#user) changes a [keeper](#keeper) and marks a group [reviewed](#reviewed).

## Words we do not use

`#words-we-do-not-use`

| Not this | But this | Why |
|---|---|---|
| scan, for a pass over a [source](#source) | [run](#run) | A scan is a scanned paper. |
| document, photo, [attachment](#attachment) as units | [file](#file) | The file is the only unit. Document and photo are its [kind](#kind). |
| cloud | [source](#source), [location](#location), [provider](#provider) | "Cloud" is not a term. |
| owner, for the machine that reads a [source](#source) | [reader](#reader) | "Owner" reads as a person. The machine is the reader. |
| type | [kind](#kind), [doc_type](#doc_type), [ext](#ext) | "Type" meant three things. |
| deleted | [vanished](#vanished) | The app never deletes. |
| backend, or the machine's model name | [server](#server) | One word for the machine. |
| content | [bytes](#bytes) | One word. |
| dup, dups | [duplicate](#duplicate) | `dups` is only a command's name. |
| near, for geography | [place](#place) | Near is for [duplicates](#duplicate). Searching photos near a place is not part of the index item. |
| temp directory | (see below) | [Files](#file) are no longer fetched and thrown away: the [server](#server) keeps a [local copy](principles.md#local-copy). |

## Words still to name

Concepts that have no agreed word yet. Each is described in plain language
here and wherever else it appears. The founder names them; the place where he
rules is [open-questions.md](open-questions.md#words).

### What a puller and a collector have in common

Both contain the thing that lists one [source](#source), reports its changes since the
[cursor](#cursor), and hands over [bytes](#bytes). That thing has no word.

Candidates: **puller** for both · **source reader** · no shared word, just
"source" as the name of the interface.

Question: [open question: name for reading a source](open-questions.md#question-name-for-reading-a-source).

### What a run talks to

When a [source](#source) is run, something takes the [file records](#file-record), keeps the [cursor](#cursor) and
the [checkpoint](#checkpoint), says which [files](#file) are unchanged, and marks [vanished](#vanished) files. That
something has no word.

Candidates: **ingest**, stretched beyond taking file records · two things,
**ingest** and **cursor** · no word, named after the use-case.

Question: [open question: name for what a run talks to](open-questions.md#question-name-for-what-a-run-talks-to).

### How far a file is through the pipeline

Which [pipeline](#pipeline) steps a [file](#file) has completed, and with which model.

Candidates: **processed steps** · **pipeline state** · one timestamp per step
and no collective word.

Question: [open question: name for pipeline progress](open-questions.md#question-name-for-pipeline-progress).

### One entry in a search answer

Candidates: **result** · **match**.

Question: [open question: name for a search entry](open-questions.md#question-name-for-a-search-entry).

### Where the local copies are kept

The place on the [server](#server) that holds the local copy of every [file](#file), addressed by
[sha256](#md5-and-sha256). It used to be the temp directory, which no longer describes it.

Candidates: none proposed yet.

Question: [open question: name for the store of local copies](open-questions.md#question-name-for-the-store-of-local-copies).
