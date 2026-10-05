# Sources

Where [assets](domain-language.md#asset) come from: which places the app reads,
which machine reads each, and how [e-mail](domain-language.md#e-mail) is
handled. Read this to understand what the app can reach and how a new kind of
[source](domain-language.md#source) would be added.

## What a source is

`#what-a-source-is`

A [source](domain-language.md#source) is one configured place
[assets](domain-language.md#asset) come from. It has three parts:

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
[assets](domain-language.md#asset) are flagged as also belonging to someone else.

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
  [asset](domain-language.md#asset) would be indexed twice, through two machines.
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
  [asset](domain-language.md#asset) it reports as new or changed, so the
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

## Identity of an asset

`#identity-of-an-asset`

Identity is never the machine. An [asset](domain-language.md#asset) is identified
by its [location](domain-language.md#location), its
[account](domain-language.md#account) and its
[source_asset_id](domain-language.md#source_asset_id). So the same asset seen
from two machines is one row. Which machine sent it is kept only for
diagnostics.

Names that come from a Mac are stored in one normal form (NFC), because macOS
writes them in another.

## File types

`#file-types`

The app indexes PDF, JPG, PNG, HEIC, TIFF and GIF
[assets](domain-language.md#asset). Videos (MOV, MP4) get
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
[run](domain-language.md#run) see that an [asset](domain-language.md#asset) is
unchanged without fetching its [bytes](domain-language.md#bytes). The full rule
is [unchanged assets](how-it-works.md#unchanged-assets).

## E-mail as a source

`#e-mail-as-a-source`

Many official documents, such as receipts, notices, contracts and invoices,
exist only as [e-mail](domain-language.md#e-mail)
[attachments](domain-language.md#attachment). That is why a mailbox is a
[source](domain-language.md#source).

- Every [e-mail](domain-language.md#e-mail) is looked at, at least enough to
  tell whether it is an [advertisement](domain-language.md#advertisement) or
  [spam](domain-language.md#spam). None is skipped unseen.
- An [e-mail](domain-language.md#e-mail) that is neither is indexed fully, as
  an [asset](domain-language.md#asset): its
  [message body](domain-language.md#message-body) and its
  [attachments](domain-language.md#attachment). This rule still waits for
  confirmation:
  [open question: e-mail indexed fully](open-questions.md#question-e-mail-indexed-fully).
- An [attachment](domain-language.md#attachment) (a PDF or an image) is
  indexed as an [asset](domain-language.md#asset) and goes through the same
  [pipeline](domain-language.md#pipeline) as any other asset,
  including grouping with [duplicates](domain-language.md#duplicate) from all
  other [sources](domain-language.md#source).
- An [attachment](domain-language.md#attachment)'s
  [asset_date](domain-language.md#asset_date) is the date the
  [e-mail](domain-language.md#e-mail) was received.
- An [attachment](domain-language.md#attachment)'s
  [source_link](domain-language.md#source_link) opens its
  [e-mail](domain-language.md#e-mail) thread in the mailbox's web page.
- The [sender](domain-language.md#sender), the subject and the thread are kept
  with the [asset](domain-language.md#asset).

How an [attachment](domain-language.md#attachment)'s id is formed is open:
[open question: attachment id](open-questions.md#question-attachment-id).

## Each e-mail is judged by what it is

`#each-e-mail-is-judged-by-what-it-is`

An [e-mail](domain-language.md#e-mail) is judged by what it is, not by its
[sender](domain-language.md#sender). The same online shop sends an invoice the
[user](domain-language.md#user) keeps and an offer he does not, so a sender is
on neither side.

| The [e-mail](domain-language.md#e-mail) is | How it is told | What the index does |
|---|---|---|
| an [advertisement](domain-language.md#advertisement) | its [mail_label](domain-language.md#mail_label) says promotions | records its [sender](domain-language.md#sender), subject, date and mail_label, and nothing else |
| [spam](domain-language.md#spam) | its [mail_label](domain-language.md#mail_label) says spam; a model is asked only about an e-mail that no mail_label marks, to find spam that came through | records it the same way as an [advertisement](domain-language.md#advertisement) |
| neither | | indexes it fully: its [message body](domain-language.md#message-body) and its [attachments](domain-language.md#attachment) |

Rules:

- **The [mail_label](domain-language.md#mail_label) comes first.** It is what
  the [provider](domain-language.md#provider) says about an
  [e-mail](domain-language.md#e-mail), and reading it is deterministic. A model
  is asked only about an e-mail that no mail_label marks:
  [deterministic code first](principles.md#deterministic-code-first).
- **An invoice must not be taken for an
  [advertisement](domain-language.md#advertisement).** An
  [e-mail](domain-language.md#e-mail) is an advertisement only when its
  [mail_label](domain-language.md#mail_label) says promotions. An unsubscribe
  header is a header of the e-mail, not a mail_label, and alone it never
  decides: invoices carry one too.
- **An [e-mail](domain-language.md#e-mail) with an attached PDF is never
  [blacklisted](domain-language.md#blacklist) by its
  [mail_label](domain-language.md#mail_label) alone.**
- **An [advertisement](domain-language.md#advertisement) is valid for one week
  after it arrived**, whether or not the [user](domain-language.md#user) was
  interested. After that it is [blacklisted](domain-language.md#blacklist).
  The week is a rule in code. No model reads a date from the offer.
- **[Spam](domain-language.md#spam) is, first of all, an
  [e-mail](domain-language.md#e-mail) whose
  [mail_label](domain-language.md#mail_label) says spam.** It is
  [blacklisted](domain-language.md#blacklist). Spam that came through is spam
  that no mail_label marks; a model judges it.
- **Of an [advertisement](domain-language.md#advertisement) and of
  [spam](domain-language.md#spam) the [server](domain-language.md#server)
  keeps only** the [sender](domain-language.md#sender), subject, date and
  [mail_label](domain-language.md#mail_label). Neither gets a
  [local copy](domain-language.md#local-copy), a
  [description](domain-language.md#description) or any other
  [pipeline](domain-language.md#pipeline) step. They are on their way out.
- **A model's verdict never ends in deletion by itself.** An
  [asset](domain-language.md#asset)
  [blacklisted](domain-language.md#blacklist) by a rule leaves the
  [quarantine](domain-language.md#quarantine) by itself after 30 days.
  [Spam](domain-language.md#spam) a model judged stays there until the
  [user](domain-language.md#user) confirms it.
- **[Whitelisted](domain-language.md#whitelist) is a default, not a
  guarantee.** A personal [e-mail](domain-language.md#e-mail) from a family
  member is usually whitelisted. Which rules give the default is open:
  [open question: whitelisted by default](open-questions.md#question-whitelisted-by-default).
- A no-reply address is **not** a sign of
  [advertisement](domain-language.md#advertisement). Invoices and receipts come
  from such [senders](domain-language.md#sender).
- A picture inside an [e-mail](domain-language.md#e-mail)'s text, such as a
  logo, is never an [attachment](domain-language.md#attachment).

The index only records whether an [asset](domain-language.md#asset) is
[whitelisted](domain-language.md#whitelist),
[blacklisted](domain-language.md#blacklist) or neither. It never writes to the
mailbox. Moving a blacklisted [e-mail](domain-language.md#e-mail) to the
[quarantine](domain-language.md#quarantine) belongs to clean-up
([FEATURE-002](../backlog/BACKLOG.md)), which is parked. The same verdicts
apply to every asset, not only to e-mail:
[whitelisted, blacklisted or neither](how-it-works.md#whitelisted-blacklisted-or-neither).

## Adding a source

`#adding-a-source`

A new kind of [source](domain-language.md#source) is a new adapter and a
configuration entry. Nothing in the domain rules or the use-cases changes, which
is why [location](domain-language.md#location) is an open list. The layering
that makes this possible is described in
[ports and adapters](architecture.md#ports-and-adapters).
