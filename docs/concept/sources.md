# Sources

Where [files](domain-language.md#file) come from: which places the app reads,
which machine reads each, and how [e-mail](domain-language.md#e-mail) is
handled. Read this to understand what the app can reach and how a new kind of
[source](domain-language.md#source) would be added.

## What a source is

`#what-a-source-is`

A [source](domain-language.md#source) is one configured place
[files](domain-language.md#file) come from. It has three parts:

| Part | Meaning | Example |
|---|---|---|
| [location](domain-language.md#location) | which kind of place | `gdrive` |
| [account](domain-language.md#account) | whose login it is read with | one Google account |
| [reader](domain-language.md#reader) | which machine reads it | the [server](domain-language.md#server), or a Mac that runs a [collector](domain-language.md#collector) |

[Sources](domain-language.md#source) are configured centrally on the
[server](domain-language.md#server). A source is stored with its position in the
[provider](domain-language.md#provider)'s change feed, whether it is enabled,
when its last [run](domain-language.md#run) finished, and its rank in the
[user](domain-language.md#user)'s
[order of sources](domain-language.md#order-of-sources).

An [account](domain-language.md#account) that belongs to more than one person is
a [shared account](domain-language.md#shared-account). Its
[files](domain-language.md#file) are flagged as also belonging to someone else.

## Shipped locations

`#shipped-locations`

| Location | Read through | Read by |
|---|---|---|
| `onedrive` | Microsoft Graph API, read-only | the [server](domain-language.md#server) |
| `gdrive` | Google Drive API, read-only | the [server](domain-language.md#server) |
| `email` | Gmail API, read-only | the [server](domain-language.md#server) |
| `icloud_photos` | the program `osxphotos` on a Mac | a Mac [collector](domain-language.md#collector) |
| `icloud_drive` | the iCloud Drive folder on a Mac | a Mac [collector](domain-language.md#collector) |

A [user](domain-language.md#user) can have several
[accounts](domain-language.md#account) per
[location](domain-language.md#location); each is its own
[source](domain-language.md#source).

Other mailboxes, read over IMAP, are not part of the index item.

## Who reads a source

`#who-reads-a-source`

- **The [server](domain-language.md#server) reads cloud
  [sources](domain-language.md#source) directly**, through their
  [providers](domain-language.md#provider), with a
  [puller](domain-language.md#puller) per source. No Mac needs to be on for
  them.
- **Folders that a desktop program syncs onto a Mac are not used as
  [sources](domain-language.md#source).** Otherwise the same
  [file](domain-language.md#file) would be indexed twice, through two machines.
- **A Mac [collector](domain-language.md#collector) exists only for what needs
  macOS**: iCloud Photos and iCloud Drive.

## Mac collector

`#mac-collector`

The [collector](domain-language.md#collector) is the same code on every Mac.
Each one is configured with the [sources](domain-language.md#source) it
[fetches](domain-language.md#fetching).
One Mac is enough; a second Mac's collector stays disabled unless it has sources
the first does not, and enabling it is configuration only.

- The [collector](domain-language.md#collector) keeps no state. It reads the
  [cursor](domain-language.md#cursor) and the
  [checkpoint](domain-language.md#checkpoint) from the
  [server](domain-language.md#server) when a [run](domain-language.md#run)
  starts.
- It computes the hashes locally and uploads the
  [bytes](domain-language.md#bytes) of every
  [file](domain-language.md#file) it reports as new or changed, so the
  [server](domain-language.md#server) can keep its
  [local copy](domain-language.md#local-copy).
- The [server](domain-language.md#server) never calls a Mac, because a Mac may
  be asleep. The [collector](domain-language.md#collector) always calls the
  server.
- It reads the photo library only through `osxphotos`, never directly.

Two points are open: what happens when two
[collectors](domain-language.md#collector) report the same
[source](domain-language.md#source)
([open question: two collectors, one source](open-questions.md#question-two-collectors-one-source)),
and what to do when the photo originals are not stored on the Mac
([open question: photo originals](open-questions.md#question-photo-originals)).

## Identity of a file

`#identity-of-a-file`

Identity is never the machine. A [file](domain-language.md#file) is identified
by its [location](domain-language.md#location), its
[account](domain-language.md#account) and its
[source_file_id](domain-language.md#source_file_id). So the same file seen
from two machines is one row. Which machine sent it is kept only for
diagnostics.

Names that come from a Mac are stored in one normal form (NFC), because macOS
writes them in another.

## File types

`#file-types`

The app indexes PDF, JPG, PNG, HEIC, TIFF and GIF
[files](domain-language.md#file). Videos (MOV, MP4) get
their metadata and hashes and no OCR.

## Reading changes

`#reading-changes`

After the first full [run](domain-language.md#run), a
[source](domain-language.md#source) is read incrementally through its
[provider](domain-language.md#provider)'s change feed. The stored position in
that feed is the [cursor](domain-language.md#cursor).

| Location | Change feed | [Provider hash](domain-language.md#provider-hash) |
|---|---|---|
| `onedrive` | delta queries | `quickXorHash`, and sha1 or sha256 where present |
| `gdrive` | the changes list, with a stored page token | `md5Checksum` |
| `email` | the history list, with a stored history id | none |

The [provider hash](domain-language.md#provider-hash) lets a
[run](domain-language.md#run) see that a [file](domain-language.md#file) is
unchanged without fetching its [bytes](domain-language.md#bytes). The full rule
is [unchanged files](how-it-works.md#unchanged-files).

## E-mail as a source

`#e-mail-as-a-source`

Many official documents, such as receipts, notices, contracts and invoices,
exist only as [e-mail](domain-language.md#e-mail)
[attachments](domain-language.md#attachment). That is why a mailbox is a
[source](domain-language.md#source).

- An [attachment](domain-language.md#attachment) (a PDF or an image) is
  indexed as a [file](domain-language.md#file) and goes through the same
  [pipeline](domain-language.md#pipeline) as any other file,
  including grouping with [duplicates](domain-language.md#duplicate) from all
  other [sources](domain-language.md#source).
- Not every [message body](domain-language.md#message-body) is indexed. That
  would be too much volume and noise, and the mailbox's own search already
  covers it.
- An [attachment](domain-language.md#attachment)'s
  [file_date](domain-language.md#file_date) is the date the
  [e-mail](domain-language.md#e-mail) was received.
- An [attachment](domain-language.md#attachment)'s
  [source_link](domain-language.md#source_link) opens its
  [e-mail](domain-language.md#e-mail) thread in the mailbox's web page.
- The [sender](domain-language.md#sender), the subject and the thread are kept
  with the [file](domain-language.md#file).

How an [attachment](domain-language.md#attachment)'s id is formed is open:
[open question: attachment id](open-questions.md#question-attachment-id).

## Senders decide

`#senders-decide`

[Senders](domain-language.md#sender) decide which
[e-mails](domain-language.md#e-mail) are indexed. The
[user](domain-language.md#user) keeps two lists of senders:

| List | Effect |
|---|---|
| [whitelist](domain-language.md#whitelist) | [E-mails](domain-language.md#e-mail) from these [senders](domain-language.md#sender) are indexed. |
| [blacklist](domain-language.md#blacklist) | Nothing from these [senders](domain-language.md#sender) is indexed, [attachments](domain-language.md#attachment) included. |

Rules:

- A no-reply address is **not** a sign of
  [advertisement](domain-language.md#advertisement). Invoices and receipts come
  from such [senders](domain-language.md#sender).
- A picture inside an [e-mail](domain-language.md#e-mail)'s text, such as a
  logo, is never an [attachment](domain-language.md#attachment).
- The [provider](domain-language.md#provider)'s hints about an
  [e-mail](domain-language.md#e-mail) (for example "filed under promotions" or
  "has an unsubscribe header") are only reported. The decision is made by the
  app's own rule from the two lists.
- Both lists are stored in the database and kept through the command line.

Three points are open:

- whether the [whitelist](domain-language.md#whitelist) is also the list that
  decides which [message bodies](domain-language.md#message-body) are indexed:
  [open question: whitelist and official senders](open-questions.md#question-whitelist-and-official-senders);
- what happens to a [sender](domain-language.md#sender) on neither list:
  [open question: unknown senders](open-questions.md#question-unknown-senders);
- what happens when a sender is put on the
  [blacklist](domain-language.md#blacklist) after its
  [e-mails](domain-language.md#e-mail) were indexed:
  [open question: blacklisted after indexing](open-questions.md#question-blacklisted-after-indexing).

## Adding a source

`#adding-a-source`

A new kind of [source](domain-language.md#source) is a new adapter and a
configuration entry. Nothing in the domain rules or the use-cases changes, which
is why [location](domain-language.md#location) is an open list. The layering
that makes this possible is described in
[ports and adapters](architecture.md#ports-and-adapters).
