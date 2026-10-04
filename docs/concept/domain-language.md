# Domain language

The agreed words of stash2flow, each with its meaning. Read this before writing
or reviewing anything: code, tests, feature files, logs, the command line and
the API use exactly these words. The words are the founder's.

Each word has its own heading. The last two sections list the words that are
deliberately not used, and the concepts that still have no agreed word.

## Agreed words only

`#agreed-words-only`

- Code, tests, feature files, logs, the command line and the API use exactly
  the words in this document.
- A concept without an agreed word is not built until it has one.
- Nobody but the founder adds a word. A missing word is raised as a question to
  him. Until he answers, the concept is described in plain language.

The founder ruled on the words on 3 October 2026.

## Language of the app

`#language-of-the-app`

- Code, command line, API, comments, logs and the fields the app generates
  (description, doc_type, kind) are in **English**.
- Text read from a document is stored **as it is**, in its original language.
- Proper names of documents and institutions stay verbatim inside an English
  description.
- Search must match across languages and ignore accents.

## The app and who uses it

### User

`#user`

The person who runs the app and makes its choices: the order of sources, the
keeper, the whitelist and blacklist, starting a run.

### Server

`#server`

The one local machine that runs the database, the API, the pullers, the workers
and the scheduler. It also keeps the local copies of the files.

### API

`#api`

What the server serves to its clients: the collectors, the command line and the
browser. Taking file records in is one part of the API.

### Worker

`#worker`

A server process that reads text from pages, computes embeddings or writes
descriptions.

### Scheduler

`#scheduler`

What starts a source's run by itself, 30 days after its last finished run.

## Where files come from

### Source

`#source`

One configured place files come from: a location plus an account, read by one
reader. Example: one Google Drive of one account is a source; the mailbox of the
same account is another.

### Location

`#location`

Which kind of place a source is. It is an open list, with one value per source
adapter. Shipped: `onedrive`, `gdrive`, `icloud_drive`, `icloud_photos`,
`email`.

### Account

`#account`

Whose login the source is read with.

### Shared account

`#shared-account`

An account that belongs to more than one person. Its files are flagged as also
belonging to someone else, so the user never treats them as his alone.

### Reader

`#reader`

The machine that reads a source: the server, or a Mac that runs a collector.
Example: a cloud drive's reader is the server; a photo library that only a Mac
can open has that Mac as its reader.

Named by the founder on 4 October 2026. The word "owner" is not used for this.

### Order of sources

`#order-of-sources`

The user's ranking of his sources. In a duplicate group, the highest-ranked
source gives the keeper. What is ranked is a source, not a location.

### Provider

`#provider`

The company's API behind a location. Example: the provider behind `gdrive` is
Google's Drive API.

### Puller

`#puller`

The program on the server that reads one cloud source through its provider.

### Collector

`#collector`

The program on a Mac that reads the sources that need macOS. A puller and a
collector are different programs.

### collected_by

`#collected_by`

Which machine sent a file record. It is kept for diagnostics only and is never
part of a file's identity.

## Files

### File

`#file`

The unit that is indexed: one row. It is identified by its location, its
account and its source_file_id. A document, a photo, an attachment and an
indexed message body are all files.

### File record

`#file-record`

What a puller or a collector sends about one file.

### source_file_id

`#source_file_id`

The file's id inside its source. Example: the provider's item id, or the id a
photo has in the photo library.

### Bytes

`#bytes`

What a file consists of. The word is always bytes, never "content".

### ext

`#ext`

The file's extension, such as PDF or JPG.

### Kind

`#kind`

What sort of file it is: `document`, `photo`, `screenshot`, `video` or `other`.
"Document" and "photo" are kinds of a file, not units of their own.

### Scan

`#scan`

A scanned paper, and nothing else. One pass over a source is a run, not a scan.

### open_link

`#open_link`

The link that opens the file where it lives. Example: the web address of a file
in a cloud drive, or the link to an e-mail's thread.

### Place

`#place`

Where a photo was taken. Not to be confused with location, which is the kind of
source.

### file_date

`#file_date`

The best available date of the file. `file_date_source` says where it came
from: the photo's own data, the PDF's creation date, the modification time, the
photo library, or the date an e-mail was received.

## Mailboxes

### E-mail

`#e-mail`

One message in a mailbox.

### Sender

`#sender`

Who an e-mail comes from.

### Whitelist

`#whitelist`

The senders, kept by the user, whose e-mails are indexed.

### Blacklist

`#blacklist`

The senders, kept by the user, from whom nothing is indexed.

### Advertisement

`#advertisement`

An e-mail the user does not want indexed. It is told by its sender being on the
blacklist, never by a no-reply address.

### Attachment

`#attachment`

A PDF or an image attached to an e-mail. It is indexed as a file. A picture
inside the e-mail's text, such as a logo, is not an attachment.

### Message body

`#message-body`

The text of an e-mail. Which bodies are indexed is open:
[#question-whitelist-and-official-senders](open-questions.md#question-whitelist-and-official-senders).

### Official sender and keyword

`#official-sender-and-keyword`

Two earlier lists that said which message bodies are indexed: senders that are
official institutions, and words to look for. Whether they remain next to the
whitelist is the same open question as for the message body.

## Runs

### Run

`#run`

One pass over a source. The first run is full; later runs are incremental and
read only what changed.

### Cursor

`#cursor`

The stored position in a source's change feed at its provider. An incremental
run starts from it.

### Checkpoint

`#checkpoint`

How far an interrupted first run got, stored per source. It is not the same as
the cursor.

### Vanished

`#vanished`

A file that is no longer in its source. The row stays, and its `deleted_at` is
set. The word is vanished, because the app never deletes.

### Summary notification

`#summary-notification`

The message sent when a run finishes.

### Baseline

`#baseline`

The figures recorded at the first full run of a source and kept unchanged: what
the user had before organizing and cleaning up.

## The pipeline

### Pipeline

`#pipeline`

The steps every file goes through.

### Discovery

`#discovery`

The pipeline step that lists a source and sends file records.

### Provider hash

`#provider-hash`

A hash the provider reports for a file. It is used to see that a file is
unchanged without fetching its bytes.

### md5 and sha256

`#md5-and-sha256`

Hashes computed on the file's bytes.

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

Whether the file has enough OCR text to count as having text.

### Description

`#description`

One English line about a file of kind `document`.

### doc_type

`#doc_type`

What type of document it is, from a fixed English vocabulary such as `tax` or
`invoice`. On the command line the flag is `--doc-type`.

### doc_date

`#doc_date`

The date printed on the document.

### Person

`#person`

Who the file is about or shows, from a list the user keeps. The same word is
used for a person on a document and a person recognised in a photo.

### Issuer

`#issuer`

The institution that issued the document.

### Embedding

`#embedding`

A vector for a photo or for OCR text. It lets a search find things by meaning.

## Duplicates

### Duplicate

`#duplicate`

A file that is the same as another file. The word is always written out.
`dups` exists only as the name of a command.

### Duplicate group

`#duplicate-group`

Files that are the same. A group is exact or near.

### Exact

`#exact`

The same bytes.

### Near

`#near`

The same image at another resolution or in another format. The word is used
only for duplicates.

### Keeper

`#keeper`

The file suggested to keep in a duplicate group.

### Non-keeper

`#non-keeper`

Every other file in the group.

### Reviewed

`#reviewed`

Set by the user on a duplicate group. Until then the keeper is only a
suggestion.

### Duplicate report

`#duplicate-report`

The web page that shows duplicate groups with thumbnails side by side, where
the user changes a keeper and marks a group reviewed.

## Words we do not use

`#words-we-do-not-use`

| Not this | But this | Why |
|---|---|---|
| scan, for a pass over a source | run | A scan is a scanned paper. |
| document, photo, attachment as units | file | The file is the only unit. Document and photo are its kind. |
| cloud | source, location, provider | "Cloud" is not a term. |
| owner, for the machine that reads a source | reader | "Owner" reads as a person. The machine is the reader. |
| type | kind, doc_type, ext | "Type" meant three things. |
| deleted | vanished | The app never deletes. |
| backend, or the machine's model name | server | One word for the machine. |
| content | bytes | One word. |
| dup, dups | duplicate | `dups` is only a command's name. |
| near, for geography | place | Near is for duplicates. Searching photos near a place is not part of the index item. |
| temp directory | (see below) | Files are no longer fetched and thrown away: the server keeps a [#local-copy](principles.md#local-copy). |

## Words still to name

Concepts that have no agreed word yet. Each is described in plain language
here and wherever else it appears. The founder names them; the place where he
rules is [open-questions.md](open-questions.md#words).

### What a puller and a collector have in common

Both contain the thing that lists one source, reports its changes since the
cursor, and hands over bytes. That thing has no word.

Candidates: **puller** for both · **source reader** · no shared word, just
"source" as the name of the interface.

Question: [#question-name-for-reading-a-source](open-questions.md#question-name-for-reading-a-source).

### What a run talks to

When a source is run, something takes the file records, keeps the cursor and
the checkpoint, says which files are unchanged, and marks vanished files. That
something has no word.

Candidates: **ingest**, stretched beyond taking file records · two things,
**ingest** and **cursor** · no word, named after the use-case.

Question: [#question-name-for-what-a-run-talks-to](open-questions.md#question-name-for-what-a-run-talks-to).

### How far a file is through the pipeline

Which pipeline steps a file has completed, and with which model.

Candidates: **processed steps** · **pipeline state** · one timestamp per step
and no collective word.

Question: [#question-name-for-pipeline-progress](open-questions.md#question-name-for-pipeline-progress).

### One entry in a search answer

Candidates: **result** · **match**.

Question: [#question-name-for-a-search-entry](open-questions.md#question-name-for-a-search-entry).

### Where the local copies are kept

The place on the server that holds the local copy of every file, addressed by
sha256. It used to be the temp directory, which no longer describes it.

Candidates: none proposed yet.

Question: [#question-name-for-the-store-of-local-copies](open-questions.md#question-name-for-the-store-of-local-copies).
