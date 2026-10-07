# Sources

Where [assets](domain-language.md#asset) come from: which places the app
[fetches](domain-language.md#fetching), which machine fetches each, and how
[e-mail](domain-language.md#e-mail) is handled. Read this to understand what the app can reach and how a new kind of
[source](domain-language.md#source) would be added.

## What a source is

`#what-a-source-is`

A [source](domain-language.md#source) is one configured place
[assets](domain-language.md#asset) come from. It has three parts:

| Part | Meaning | Example |
|---|---|---|
| [location](domain-language.md#location) | which kind of place | `gdrive` |
| [account](domain-language.md#account) | whose login it is [fetched](domain-language.md#fetching) with | one Google account |
| [reader](domain-language.md#reader) | which machine [fetches](domain-language.md#fetching) it | the [server](domain-language.md#server), or a Mac that runs a [collector](domain-language.md#collector) |

[Sources](domain-language.md#source) are configured centrally on the
[server](domain-language.md#server). A source is stored with its position in the
[provider](domain-language.md#provider)'s change feed, whether it is enabled,
when its last [run](domain-language.md#run) finished, and its rank in the
[user](domain-language.md#user)'s
[order of sources](domain-language.md#order-of-sources). How the user adds
one is in [adding a source](#adding-a-source).

A [source](domain-language.md#source) is unique by its
[location](domain-language.md#location) and its
[account](domain-language.md#account). Its
[reader](domain-language.md#reader) is the machine that normally
[fetches](domain-language.md#fetching) it.

An [account](domain-language.md#account) that belongs to more than one person is
a [shared account](domain-language.md#shared-account). Its
[assets](domain-language.md#asset) are flagged as also belonging to someone else.

## Shipped locations

`#shipped-locations`

| Location | Fetched through | Fetched by |
|---|---|---|
| `onedrive` | Microsoft Graph API, read-only | the [server](domain-language.md#server) |
| `gdrive` | Google Drive API, read-only | the [server](domain-language.md#server) |
| `email` | Gmail API, read-only | the [server](domain-language.md#server) |
| `icloud_photos` | the program `osxphotos` on a Mac | a Mac [collector](domain-language.md#collector) |
| `icloud_drive` | the iCloud Drive folder on a Mac | a Mac [collector](domain-language.md#collector) |
| `network_folder` | a folder on the local network, such as one on a network storage device | the [server](domain-language.md#server) |

A [user](domain-language.md#user) can have several
[accounts](domain-language.md#account) per
[location](domain-language.md#location); each is its own
[source](domain-language.md#source).

Other mailboxes, fetched over IMAP, are not part of the index item.

A network storage device is a [source](domain-language.md#source): a folder on
the network that the [server](domain-language.md#server) can reach. It is
[fetched](domain-language.md#fetching) like any other source, with the server
as its [reader](domain-language.md#reader).

Such a device may be switched off while a copy of it exists somewhere else.
The app indexes whichever of the two is reachable. If both are, the same
[bytes](domain-language.md#bytes) form [exact](domain-language.md#exact)
[duplicates](domain-language.md#duplicate), and the
[order of sources](domain-language.md#order-of-sources) decides the
[keeper](domain-language.md#keeper).

## Who fetches a source

`#who-fetches-a-source`

A [source](domain-language.md#source) is
[fetched](domain-language.md#fetching); an [asset](domain-language.md#asset) is
read. The machine that fetches a source is its
[reader](domain-language.md#reader). Reading an asset, which means taking its
text and pictures out, is done only by the
[guardian](domain-language.md#guardian).

- **The [server](domain-language.md#server)
  [fetches](domain-language.md#fetching) cloud
  [sources](domain-language.md#source) directly**, through their
  [providers](domain-language.md#provider), with a
  [puller](domain-language.md#puller) per source. No Mac needs to be on for
  them.
- **The [server](domain-language.md#server)
  [fetches](domain-language.md#fetching) a folder on a network storage device
  directly too**, because it can reach the folder itself.
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
- It [fetches](domain-language.md#fetching) the photo library only through
  `osxphotos`, never directly.
- Where the inside of an [asset](domain-language.md#asset) is needed on the
  Mac, the [guardian](domain-language.md#guardian) reads it there, in the same
  isolation as on the [server](domain-language.md#server).

Two Macs can see the same [asset](domain-language.md#asset) only when both
[fetch](domain-language.md#fetching) the same
[source](domain-language.md#source). The source stays one source, because it is
unique by its [location](domain-language.md#location) and its
[account](domain-language.md#account). The
[asset records](domain-language.md#asset-record) a second
[collector](domain-language.md#collector) sends for it update the same rows,
and [collected_by](domain-language.md#collected_by) records which machine sent
them.

What to do when the photo originals are not stored on the Mac is open:
[open question: photo originals](open-questions.md#question-photo-originals).

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

What the app does with a file depends on its file type:

| File | What the app does |
|---|---|
| PDF, JPG, PNG, HEIC, TIFF, GIF | indexes it fully, through the whole [pipeline](domain-language.md#pipeline) |
| an office document: a word-processor or spreadsheet file | the [guardian](domain-language.md#guardian) reads its text. Its macros are never run, and taking the text out does not need them |
| a video (MOV, MP4) | does not fetch its [bytes](domain-language.md#bytes), so its metadata is what the [provider](domain-language.md#provider)'s listing gives: name, size and dates. Records that and its [provider hash](domain-language.md#provider-hash); no OCR. Whether the [server](domain-language.md#server) keeps a [local copy](domain-language.md#local-copy) of videos is the [user](domain-language.md#user)'s decision: [a local copy of every asset](principles.md#a-local-copy-of-every-asset) |
| an archive, such as a zip file | does not open it. Records its name, size and hash, and lists it so the [user](domain-language.md#user) sees what is not covered |
| a program, or a file whose file type the app does not know | records its name, size and hash only. The [guardian](domain-language.md#guardian) never reads such a file |

A file beyond a limit on its size or on its number of pages is refused: the
[guardian](domain-language.md#guardian) does not read it. The
[user](domain-language.md#user) sets both limits.

A [provider](domain-language.md#provider)'s own document, for example a
word-processor or spreadsheet document that lives only in the provider's web
application, is not a file: it has no [bytes](domain-language.md#bytes) to
fetch. What the app does with it is open:
[open question: a provider's own documents](open-questions.md#question-a-providers-own-documents).

Nothing inside a file is ever run:
[the app reads what it trusts, in isolation, and runs nothing](principles.md#the-app-reads-what-it-trusts-in-isolation-and-runs-nothing).

## Fetching changes

`#fetching-changes`

After the first full [run](domain-language.md#run), a
[source](domain-language.md#source) is [fetched](domain-language.md#fetching)
incrementally through its
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
  an [asset](domain-language.md#asset), when its
  [sender](domain-language.md#sender) is
  [trusted](domain-language.md#trusted): its
  [message body](domain-language.md#message-body) and its
  [attachments](domain-language.md#attachment). The rule is
  [who is trusted](#who-is-trusted).
- Of an [e-mail](domain-language.md#e-mail) from an
  [undecided sender](domain-language.md#undecided-sender), only the sender,
  subject, date and [mail_label](domain-language.md#mail_label) are recorded.
- An [e-mail](domain-language.md#e-mail) from a
  [rejected sender](domain-language.md#rejected-sender) is
  [spam](domain-language.md#spam).
- An [attachment](domain-language.md#attachment) (a PDF or an image) of an
  [e-mail](domain-language.md#e-mail) that is indexed fully is
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

## Who is trusted

`#who-is-trusted`

The [guardian](domain-language.md#guardian) decides whether an
[asset](domain-language.md#asset) may be read, by whether its
[source](domain-language.md#source) or [sender](domain-language.md#sender) is
[trusted](domain-language.md#trusted). Who is trusted is a rule in code, never
a model's guess.

A [sender](domain-language.md#sender) is in one of three states:

| Sender | Meaning | What the app does with its [e-mails](domain-language.md#e-mail) |
|---|---|---|
| [trusted](domain-language.md#trusted) | the [user](domain-language.md#user) has written to it, or he marked it | reads them |
| [undecided](domain-language.md#undecided-sender) | the [user](domain-language.md#user) has never dealt with it | records sender, subject, date and [mail_label](domain-language.md#mail_label), and lists the sender for him |
| [rejected](domain-language.md#rejected-sender) | the [user](domain-language.md#user) said no | [blacklists](domain-language.md#blacklist) them, by a rule |

The [mail_label](domain-language.md#mail_label) is applied before trust:

| Where the [asset](domain-language.md#asset) comes from | What the app does |
|---|---|
| The [user](domain-language.md#user)'s own drives and photo libraries, which are [trusted](domain-language.md#trusted) | reads the [asset](domain-language.md#asset) fully |
| An [e-mail](domain-language.md#e-mail) whose [mail_label](domain-language.md#mail_label) says spam, with no attached PDF | does not read it, even from a [trusted](domain-language.md#trusted) [sender](domain-language.md#sender); records its sender, subject, date and mail_label; it is [spam](domain-language.md#spam) and is [blacklisted](domain-language.md#blacklist) by a rule |
| An [e-mail](domain-language.md#e-mail) whose [mail_label](domain-language.md#mail_label) says promotions, with no attached PDF | does not read it, even from a [trusted](domain-language.md#trusted) [sender](domain-language.md#sender); records the same four things; it is an [advertisement](domain-language.md#advertisement) |
| An [e-mail](domain-language.md#e-mail) with an attached PDF whose [mail_label](domain-language.md#mail_label) says promotions or spam | from a [trusted](domain-language.md#trusted) [sender](domain-language.md#sender), reads it like any other e-mail from that sender; from any other sender the mail_label stands: it only records the same four things, and one whose mail_label says spam is [spam](domain-language.md#spam) and is [blacklisted](domain-language.md#blacklist) by a rule |
| Any other [e-mail](domain-language.md#e-mail) from a [trusted](domain-language.md#trusted) [sender](domain-language.md#sender) | reads the text and the [attachments](domain-language.md#attachment) |
| Any other [e-mail](domain-language.md#e-mail) from an [undecided sender](domain-language.md#undecided-sender) | does not read it; records the same four things and lists the sender for the [user](domain-language.md#user) |
| An [e-mail](domain-language.md#e-mail) from a [rejected sender](domain-language.md#rejected-sender) | does not read it; records the same four things; it is [spam](domain-language.md#spam) and is [blacklisted](domain-language.md#blacklist) by a rule |

- **The first [run](domain-language.md#run) over a mailbox starts by showing
  the [user](domain-language.md#user) his
  [senders](domain-language.md#sender).** Those he has written to are already
  [trusted](domain-language.md#trusted). He decides the rest: once per sender,
  not per [e-mail](domain-language.md#e-mail).
- **A later [run](domain-language.md#run) lists only the new
  [undecided senders](domain-language.md#undecided-sender).**
- **Once the [user](domain-language.md#user) says an
  [undecided sender](domain-language.md#undecided-sender) is
  [trusted](domain-language.md#trusted), the next
  [run](domain-language.md#run) reads the
  [e-mails](domain-language.md#e-mail) recorded while it was undecided.** He
  does not have to ask again.
- **A [rejected sender](domain-language.md#rejected-sender) is not listed
  again.** Its [e-mails](domain-language.md#e-mail) are
  [spam](domain-language.md#spam): recorded with the four things and
  [blacklisted](domain-language.md#blacklist) by a rule.
- **While reading an [e-mail](domain-language.md#e-mail) the app loads nothing
  from the internet**: no remote images and no following of links. Only the
  text and the [attachments](domain-language.md#attachment).
- **[Trusted](domain-language.md#trusted) is not a verdict.** It is about
  where an [asset](domain-language.md#asset) comes from and decides whether it
  is read. [Whitelisted](domain-language.md#whitelist) and
  [blacklisted](domain-language.md#blacklist) are verdicts on the asset itself:
  an online shop can be a trusted [sender](domain-language.md#sender) while its
  invoice is kept and its offer becomes trash.
- **The [guardian](domain-language.md#guardian) reads in isolation, whoever
  the [sender](domain-language.md#sender) is**: a
  [trusted](domain-language.md#trusted) sender can be compromised. See
  [the app reads what it trusts, in isolation, and runs nothing](principles.md#the-app-reads-what-it-trusts-in-isolation-and-runs-nothing).

## Each e-mail is judged by what it is

`#each-e-mail-is-judged-by-what-it-is`

An [e-mail](domain-language.md#e-mail) is judged by what it is. The same online
shop sends an invoice the [user](domain-language.md#user) keeps and an offer he
does not, so a [sender](domain-language.md#sender) is never
[whitelisted](domain-language.md#whitelist) or
[blacklisted](domain-language.md#blacklist). Whether the sender is
[trusted](domain-language.md#trusted) decides whether the e-mail is read:
[who is trusted](#who-is-trusted). The sender decides the verdict in one case
only: every e-mail from a
[rejected sender](domain-language.md#rejected-sender) is
[spam](domain-language.md#spam).

| The [e-mail](domain-language.md#e-mail) is | How it is told | What the index does |
|---|---|---|
| an [advertisement](domain-language.md#advertisement) | its [mail_label](domain-language.md#mail_label) says promotions | records its [sender](domain-language.md#sender), subject, date and mail_label, and nothing else |
| [spam](domain-language.md#spam) | its [mail_label](domain-language.md#mail_label) says spam, or it comes from a [rejected sender](domain-language.md#rejected-sender) | records it the same way as an [advertisement](domain-language.md#advertisement), and records that it is [blacklisted](domain-language.md#blacklist) |
| neither, from a [trusted](domain-language.md#trusted) [sender](domain-language.md#sender) | | indexes it fully: its [message body](domain-language.md#message-body) and its [attachments](domain-language.md#attachment) |
| neither, from an [undecided sender](domain-language.md#undecided-sender) | | records its sender, subject, date and [mail_label](domain-language.md#mail_label), and nothing else |

Rules:

- **The [mail_label](domain-language.md#mail_label) is applied before
  trust.** It is what the [provider](domain-language.md#provider) says about
  an [e-mail](domain-language.md#e-mail), and applying it is deterministic. An
  e-mail whose mail_label says promotions or spam is not read, even from a
  [trusted](domain-language.md#trusted) [sender](domain-language.md#sender),
  with the one exception of the attached PDF below.
- **No model is used for [spam](domain-language.md#spam).** Spam is an
  [e-mail](domain-language.md#e-mail) whose
  [mail_label](domain-language.md#mail_label) says spam, or an e-mail from a
  [rejected sender](domain-language.md#rejected-sender). Both are
  [blacklisted](domain-language.md#blacklist) by a rule:
  [deterministic code first](principles.md#deterministic-code-first).
- **An invoice must not be taken for an
  [advertisement](domain-language.md#advertisement).** An
  [e-mail](domain-language.md#e-mail) is an advertisement only when its
  [mail_label](domain-language.md#mail_label) says promotions. An unsubscribe
  header is a header of the e-mail, not a mail_label, and alone it never
  decides: invoices carry one too.
- **An [e-mail](domain-language.md#e-mail) with an attached PDF whose
  [mail_label](domain-language.md#mail_label) says promotions or spam** is
  read like any other e-mail from that [sender](domain-language.md#sender)
  when the sender is [trusted](domain-language.md#trusted). From any other
  sender the mail_label stands: one that says promotions is only recorded, and
  one that says spam is [spam](domain-language.md#spam) and is
  [blacklisted](domain-language.md#blacklist).
- **An [advertisement](domain-language.md#advertisement) is valid for one week
  after it arrived**, whether or not the [user](domain-language.md#user) was
  interested. After that it is [blacklisted](domain-language.md#blacklist).
  The week is a rule in code. No model reads a date from the offer. The
  verdict of a recorded advertisement is worked out from its recorded arrival
  date at every [run](domain-language.md#run) of the mailbox:
  [whitelisted, blacklisted or neither](how-it-works.md#whitelisted-blacklisted-or-neither).
- **Of an [advertisement](domain-language.md#advertisement) and of
  [spam](domain-language.md#spam) the [server](domain-language.md#server)
  keeps only** the [sender](domain-language.md#sender), subject, date and
  [mail_label](domain-language.md#mail_label). Neither gets a
  [local copy](domain-language.md#local-copy), a
  [description](domain-language.md#description) or any other
  [pipeline](domain-language.md#pipeline) step. They are on their way out.
- **Only a rule moves an [e-mail](domain-language.md#e-mail) to the
  [quarantine](domain-language.md#quarantine).** A
  [blacklisted](domain-language.md#blacklist) e-mail is moved there and is
  deleted after 30 days unless the [user](domain-language.md#user) restores
  it.
- **There is one [quarantine](domain-language.md#quarantine) for all
  [sources](domain-language.md#source).** The
  [user](domain-language.md#user) looks through it in the app, in one place,
  and never has to open each mailbox to see what is about to be deleted.
- **[Whitelisted](domain-language.md#whitelist) is a default, not a
  guarantee.** A personal [e-mail](domain-language.md#e-mail) from a family
  member is usually whitelisted. The default comes from rules the
  [user](domain-language.md#user) keeps in configuration: by
  [sender](domain-language.md#sender), when the sender is a
  [person](domain-language.md#person) on his list, and by
  [source](domain-language.md#source), for example the photo library of his
  phone.
- A no-reply address is **not** a sign of
  [advertisement](domain-language.md#advertisement). Invoices and receipts come
  from such [senders](domain-language.md#sender).
- A picture inside an [e-mail](domain-language.md#e-mail)'s text, such as a
  logo, is never an [attachment](domain-language.md#attachment).

The index only records whether an [asset](domain-language.md#asset) is
[whitelisted](domain-language.md#whitelist),
[blacklisted](domain-language.md#blacklist) or neither. It never writes to the
mailbox. Moving an [e-mail](domain-language.md#e-mail) to the
[quarantine](domain-language.md#quarantine) belongs to clean-up
([FEATURE-002](../backlog/BACKLOG.md)), which is parked. The same verdicts
apply to every asset, not only to e-mail:
[whitelisted, blacklisted or neither](how-it-works.md#whitelisted-blacklisted-or-neither).

## Adding a source

`#adding-a-source`

The [user](domain-language.md#user) adds a
[source](domain-language.md#source) with a command. The command takes him
through the [provider](domain-language.md#provider)'s sign-in once and stores
the access the app needs, which is read-only, in the
[token store](infrastructure.md#token-store). A `network_folder` needs no
sign-in: the command takes the folder's address.

Whether a sign-in stays valid for the
[30 days](how-it-works.md#thirty-days) between
[runs](domain-language.md#run) is open:
[open question: how long a sign-in stays valid](open-questions.md#question-how-long-a-sign-in-stays-valid).

A new kind of [source](domain-language.md#source) is a new adapter and a
configuration entry. Nothing in the domain rules or the use-cases changes, which
is why [location](domain-language.md#location) is an open list. The layering
that makes this possible is described in
[ports and adapters](architecture.md#ports-and-adapters).
