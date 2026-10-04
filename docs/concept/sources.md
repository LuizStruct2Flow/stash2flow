# Sources

Where files come from: which places the app reads, which machine reads each,
and how e-mail is handled. Read this to understand what the app can reach and
how a new kind of source would be added.

## What a source is

`#what-a-source-is`

A [#source](domain-language.md#source) is one configured place files come from.
It has three parts:

| Part | Meaning | Example |
|---|---|---|
| location | which kind of place | `gdrive` |
| account | whose login it is read with | one Google account |
| reader | which machine reads it | the server, or a Mac that runs a collector |

Sources are configured centrally on the server. A source is stored with its
position in the provider's change feed, whether it is enabled, when its last
run finished, and its rank in the user's
[#order-of-sources](domain-language.md#order-of-sources).

An account that belongs to more than one person is a
[#shared-account](domain-language.md#shared-account). Its files are flagged as
also belonging to someone else.

## Shipped locations

`#shipped-locations`

| Location | Read through | Read by |
|---|---|---|
| `onedrive` | Microsoft Graph API, read-only | the server |
| `gdrive` | Google Drive API, read-only | the server |
| `email` | Gmail API, read-only | the server |
| `icloud_photos` | the program `osxphotos` on a Mac | a Mac collector |
| `icloud_drive` | the iCloud Drive folder on a Mac | a Mac collector |

A user can have several accounts per location; each is its own source.

Other mailboxes, read over IMAP, are not part of the index item.

## Who reads a source

`#who-reads-a-source`

- **The server reads cloud sources directly**, through their providers, with a
  [#puller](domain-language.md#puller) per source. No Mac needs to be on for
  them.
- **Folders that a desktop program syncs onto a Mac are not used as sources.**
  Otherwise the same file would be indexed twice, through two machines.
- **A Mac collector exists only for what needs macOS**: iCloud Photos and
  iCloud Drive.

## Mac collector

`#mac-collector`

The [#collector](domain-language.md#collector) is the same code on every Mac.
Each one is configured with the sources it owns. One Mac is enough; a second
Mac's collector stays disabled unless it has sources the first does not, and
enabling it is configuration only.

- The collector keeps no state. It reads the cursor and the checkpoint from the
  server when a run starts.
- It computes the hashes locally and uploads the bytes of every file it reports
  as new or changed, so the server can keep its
  [#local-copy](principles.md#local-copy).
- The server never calls a Mac, because a Mac may be asleep. The collector
  always calls the server.
- It reads the photo library only through `osxphotos`, never directly.

Two points are open: what happens when two collectors report the same source
([#question-two-collectors-one-source](open-questions.md#question-two-collectors-one-source)),
and what to do when the photo originals are not stored on the Mac
([#question-photo-originals](open-questions.md#question-photo-originals)).

## Identity of a file

`#identity-of-a-file`

Identity is never the machine. A [#file](domain-language.md#file) is identified
by its location, its account and its
[#source_file_id](domain-language.md#source_file_id). So the same file seen
from two machines is one row. Which machine sent it is kept only for
diagnostics.

Names that come from a Mac are stored in one normal form (NFC), because macOS
writes them in another.

## File types

`#file-types`

The app indexes PDF, JPG, PNG, HEIC, TIFF and GIF files. Videos (MOV, MP4) get
their metadata and hashes and no OCR.

## Reading changes

`#reading-changes`

After the first full run, a source is read incrementally through its provider's
change feed. The stored position in that feed is the
[#cursor](domain-language.md#cursor).

| Location | Change feed | Provider hash |
|---|---|---|
| `onedrive` | delta queries | `quickXorHash`, and sha1 or sha256 where present |
| `gdrive` | the changes list, with a stored page token | `md5Checksum` |
| `email` | the history list, with a stored history id | none |

The [#provider-hash](domain-language.md#provider-hash) lets a run see that a
file is unchanged without fetching its bytes. The full rule is
[#unchanged-files](how-it-works.md#unchanged-files).

## E-mail as a source

`#e-mail-as-a-source`

Many official documents, such as receipts, notices, contracts and invoices,
exist only as e-mail attachments. That is why a mailbox is a source.

- An [#attachment](domain-language.md#attachment) (a PDF or an image) is
  indexed as a file and goes through the same pipeline as any other file,
  including grouping with duplicates from all other sources.
- Not every message body is indexed. That would be too much volume and noise,
  and the mailbox's own search already covers it.
- An attachment's file_date is the date the e-mail was received.
- An attachment's open_link opens its e-mail thread in the mailbox's web page.
- The sender, the subject and the thread are kept with the file.

How an attachment's id is formed is open:
[#question-attachment-id](open-questions.md#question-attachment-id).

## Senders decide

`#senders-decide`

Senders decide which e-mails are indexed. The user keeps two lists of
[#sender](domain-language.md#sender)s:

| List | Effect |
|---|---|
| [#whitelist](domain-language.md#whitelist) | E-mails from these senders are indexed. |
| [#blacklist](domain-language.md#blacklist) | Nothing from these senders is indexed, attachments included. |

Rules:

- A no-reply address is **not** a sign of advertisement. Invoices and receipts
  come from such senders.
- A picture inside an e-mail's text, such as a logo, is never an attachment.
- The provider's hints about an e-mail (for example "filed under promotions" or
  "has an unsubscribe header") are only reported. The decision is made by the
  app's own rule from the two lists.
- Both lists are stored in the database and kept through the command line.

Decided by the founder on 3 October 2026.

Three points are open:

- whether the whitelist is also the list that decides which message bodies are
  indexed:
  [#question-whitelist-and-official-senders](open-questions.md#question-whitelist-and-official-senders);
- what happens to a sender on neither list:
  [#question-unknown-senders](open-questions.md#question-unknown-senders);
- what happens when a sender is put on the blacklist after its e-mails were
  indexed:
  [#question-blacklisted-after-indexing](open-questions.md#question-blacklisted-after-indexing).

## Adding a source

`#adding-a-source`

A new kind of source is a new adapter and a configuration entry. Nothing in the
domain rules or the use-cases changes, which is why
[#location](domain-language.md#location) is an open list. The layering that
makes this possible is described in
[#ports-and-adapters](architecture.md#ports-and-adapters).
