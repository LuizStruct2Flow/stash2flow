# Domain language

The agreed words of stash2flow, each with its meaning. Read this before writing
or reviewing anything: code, tests, feature files, logs, the command line and
the API use exactly these words. The words are the founder's.

Each word has its own heading. The last section lists the words that are
deliberately not used.

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
[keeper](#keeper), which [senders](#sender) are [trusted](#trusted) and which
are [rejected](#rejected-sender), the rules that make an
[asset](#asset) [whitelisted](#whitelist) by default, whether the
[server](#server) keeps a [local copy](#local-copy) of videos, the limits on a
file's size and number of pages, what is restored from the
[quarantine](#quarantine), starting a [run](#run).

### Server

`#server`

The one local machine that runs the database, the [API](#api), the [pullers](#puller), the
[guardian](#guardian), the [workers](#worker) and the [scheduler](#scheduler). It also keeps the [local copies](#local-copy) of the
[assets](#asset), in the [stash](#stash).

### API

`#api`

What the [server](#server) serves to its clients: the [collectors](#collector), the command line and the
browser. Taking [asset records](#asset-record) in is one part of the API. Every client
authenticates, each with its own token.

### Worker

`#worker`

A [server](#server) process that reads text from pages, computes [embeddings](#embedding) or writes
[descriptions](#description).

### Scheduler

`#scheduler`

What starts a [source](#source)'s [run](#run) by itself, 30 days after its last finished run.

### Guardian

`#guardian`

The part of the app that decides whether an [asset](#asset) may be read, by
whether its [source](#source) or [sender](#sender) is [trusted](#trusted), and
reads it in isolation. Reading an asset means taking its text and pictures out.
Nothing else in the app touches the inside of an asset. It guards the
[server](#server): a deliberately crafted file that breaks a reading library
reaches nothing. Example: a PDF attached to an [e-mail](#e-mail) from a trusted
sender is opened by the guardian, which hands back its text and its pages as
pictures.

## Where assets come from

### Source

`#source`

One configured place [assets](#asset) come from: a [location](#location) plus an [account](#account), [fetched](#fetching) by one
[reader](#reader). A source is unique by its location and its account. A source is fetched; an asset is read. Example: one Google Drive of one account is a source; the mailbox of the
same account is another.

### Location

`#location`

Which kind of place a [source](#source) is. It is an open list, with one value per source
adapter. Shipped: `onedrive`, `gdrive`, `icloud_drive`, `icloud_photos`,
`email`, and `network_folder`, a folder on the network that the
[server](#server) can reach, such as one on a network storage device.

### Account

`#account`

Whose login the [source](#source) is [fetched](#fetching) with.

### Shared account

`#shared-account`

An [account](#account) that belongs to more than one person. Its [assets](#asset) are flagged as also
belonging to someone else, so the [user](#user) never treats them as his alone.

### Reader

`#reader`

The machine that normally [fetches](#fetching) a [source](#source): the [server](#server), or a Mac that runs a [collector](#collector).
Example: a cloud drive's reader is the server; a photo library that only a Mac
can open has that Mac as its reader. When another collector sends
[asset records](#asset-record) for the same source, the reader stays the same
and [collected_by](#collected_by) records who sent them. The reader does not read an
[asset](#asset): that is what the [guardian](#guardian) does.

### Order of sources

`#order-of-sources`

The [user](#user)'s ranking of his [sources](#source). In a [duplicate group](#duplicate-group), the highest-ranked
source gives the [keeper](#keeper). What is ranked is a source, not a [location](#location).

### Trusted

`#trusted`

Said of where an [asset](#asset) comes from: a [source](#source) or a
[sender](#sender). The [guardian](#guardian) reads an asset, which means taking
its text and pictures out, only when where it comes from is trusted. The
[user](#user)'s own drives and photo libraries are trusted. A sender is trusted
when the user has written to it himself, or has marked it as trusted. A sender
that is not trusted is an [undecided sender](#undecided-sender) or a
[rejected sender](#rejected-sender). Who is trusted is a rule in code, never a
model's guess.

The [mail_label](#mail_label) is applied before trust: an [e-mail](#e-mail)
whose mail_label says promotions or spam is not read, even from a trusted
[sender](#sender). The one exception is an e-mail with an attached PDF whose
mail_label says promotions: from a trusted sender it is read like any other
e-mail from that sender.

Trusted is not a verdict. It is about where an asset comes from;
[whitelisted](#whitelist) and [blacklisted](#blacklist) are verdicts on the
asset itself. Example: an online shop is a trusted sender, its invoice is kept
and its offer becomes trash.

### Provider

`#provider`

The company's [API](#api) behind a [location](#location). Example: the provider behind `gdrive` is
Google's Drive API.

### Fetching

`#fetching`

What a [puller](#puller) and a [collector](#collector) both do with a [source](#source): list what is
there, report what changed, and bring the [bytes](#bytes). A puller fetches a cloud
source on the [server](#server); a collector fetches the sources that need a Mac.

### Puller

`#puller`

The program on the [server](#server) that [fetches](#fetching) one cloud [source](#source) through its
[provider](#provider). It needs no Mac.

### Collector

`#collector`

The program on a Mac that [fetches](#fetching) the [sources](#source) that need macOS. A [puller](#puller)
and a collector are different programs that do the same thing in different
places: the puller runs on the [server](#server); the collector runs on a Mac and sends
what it fetched to the server through the [API](#api).

### collected_by

`#collected_by`

Which machine sent an [asset record](#asset-record). It is kept for diagnostics only and is never
part of an [asset](#asset)'s identity.

## Assets

### Asset

`#asset`

The unit that is indexed: one row. It is a file (in a cloud drive, a photo
library or a folder), an [attachment](#attachment) or an [e-mail](#e-mail). It is
identified by its [location](#location), its [account](#account) and its
[source_asset_id](#source_asset_id). Every asset is [whitelisted](#whitelist),
[blacklisted](#blacklist) or neither yet.

### Asset record

`#asset-record`

What a [puller](#puller) or a [collector](#collector) sends about one [asset](#asset).

### source_asset_id

`#source_asset_id`

The [asset](#asset)'s id inside its [source](#source). Example: the provider's item id, or the id a
photo has in the photo library.

### Bytes

`#bytes`

What an [asset](#asset) consists of. The word is always bytes, never "content".

### Local copy

`#local-copy`

The copy of an [asset](#asset)'s [bytes](#bytes) that the [server](#server) keeps. Local copies are kept
in the [stash](#stash). An [advertisement](#advertisement) and [spam](#spam)
have none, and neither has an [e-mail](#e-mail) from an
[undecided sender](#undecided-sender). A video has none until the
[user](#user) decides whether videos are kept.

### Stash

`#stash`

The place on the [server](#server) where the [local copies](#local-copy) are kept. A local copy is
addressed by its [sha256](#md5-and-sha256), so the same [bytes](#bytes) arriving from two
[sources](#source) are kept once.

### ext

`#ext`

The file's extension, such as PDF or JPG.

### Kind

`#kind`

What sort of [asset](#asset) it is: `document`, `photo`, `screenshot`, `video` or `other`.
"Document" and "photo" are kinds of an asset, not units of their own.

### Scan

`#scan`

A scanned paper, and nothing else. One pass over a [source](#source) is a [run](#run), not a scan.

### source_link

`#source_link`

The link that opens the [asset](#asset) in its [source](#source). Example: the web address of a
file in a cloud drive, or the link to an e-mail's thread. It does not point at
the [local copy](#local-copy) on the [server](#server).

### asset_date

`#asset_date`

The best available date of the [asset](#asset). `asset_date_source` says where it came
from: the photo's own data, the PDF's creation date, the modification time, the
photo library, or the date an e-mail was received.

## What is kept and what is trash

### Whitelist

`#whitelist`

The [assets](#asset) the [user](#user) keeps. An asset on it is **whitelisted**.
Whitelisted is a verdict on one asset, of any kind and from any
[source](#source); it is not a list of [senders](#sender). It is a default, not
a guarantee: rules the user keeps give it from where the asset came from, by
sender, when the sender is a [person](#person) on his list, and by source.
Example: a personal
[e-mail](#e-mail) from a family member is usually whitelisted, and so is a
photo from the user's phone.

Whitelisted is not the same as [trusted](#trusted). Trusted is said of a
[source](#source) or a [sender](#sender) and decides whether an
[asset](#asset) is read. Whitelisted is said of one asset and says it is kept.
An asset from a trusted sender can be whitelisted, blacklisted or neither.

### Blacklist

`#blacklist`

The [assets](#asset) that are trash. An asset on it is **blacklisted**.
Blacklisted is a verdict on one asset, and it is clear-cut: an
[advertisement](#advertisement) whose week of validity has passed, and
[spam](#spam).

An [asset](#asset) is blacklisted by a rule, never by a model:

- an [advertisement](#advertisement) whose week of validity has passed;
- an [e-mail](#e-mail) whose [mail_label](#mail_label) says spam;
- an [e-mail](#e-mail) from a [rejected sender](#rejected-sender).

A blacklisted [asset](#asset) could be deleted, so it is moved to the
[quarantine](#quarantine).

An [e-mail](#e-mail) with an attached PDF is never blacklisted by its
[mail_label](#mail_label) alone.

An [undecided sender](#undecided-sender) does not make an [asset](#asset)
blacklisted. Its [e-mail](#e-mail) is not read, and that is all.

### Quarantine

`#quarantine`

Where everything that could be deleted is moved. There is one quarantine for
all [sources](#source), and the [user](#user) looks through it in the app, in
one place: he never has to open each mailbox or drive to see what is about to
be deleted. He can restore an [asset](#asset) or delete it permanently.
Everything in the quarantine is deleted permanently after 30 days unless it is
restored, with no exception.

Every [asset](#asset) in the quarantine was put there by a rule: no model
[blacklists](#blacklist) an asset.

Moving an asset to the quarantine writes
to its [source](#source), so the quarantine belongs to clean-up
([FEATURE-002](../backlog/BACKLOG.md)), not to the index.

## Mailboxes

### E-mail

`#e-mail`

One message in a mailbox.

### Sender

`#sender`

Who an [e-mail](#e-mail) comes from. A sender is in one of three states:

| Sender | Meaning | What the app does with its [e-mails](#e-mail) |
|---|---|---|
| [trusted](#trusted) | the [user](#user) has written to it, or he marked it | reads them |
| [undecided](#undecided-sender) | the [user](#user) has never dealt with it | records sender, subject, date and [mail_label](#mail_label), and lists the sender for him |
| [rejected](#rejected-sender) | the [user](#user) said no | [blacklists](#blacklist) them, by a rule |

The [user](#user) says once per sender whether he trusts it, and after that the
app knows.

A sender is never [whitelisted](#whitelist) or [blacklisted](#blacklist): those
are verdicts on an [asset](#asset). The same online shop, a
[trusted](#trusted) sender, sends an invoice the [user](#user) keeps and an
offer he does not, so each of its e-mails is judged by what it is.

### Undecided sender

`#undecided-sender`

A [sender](#sender) the [user](#user) has never dealt with: he has not written
to it and has not said whether he trusts it. Its [e-mails](#e-mail) are not
read. The app records their sender, subject, date and
[mail_label](#mail_label), and lists the sender for the user. Once he says the
sender is [trusted](#trusted), the next [run](#run) reads the e-mails recorded
so far.

### Rejected sender

`#rejected-sender`

A [sender](#sender) the [user](#user) said no to. Its [e-mails](#e-mail) are
[spam](#spam): they are not read, and they are [blacklisted](#blacklist) by a
rule. The sender is not listed for the user again.

### mail_label

`#mail_label`

What the [provider](#provider) of a mailbox says about an [e-mail](#e-mail):
that it is filed under promotions, or that it is spam. An unsubscribe header is
not a mail_label: it is a header of the e-mail, and it decides nothing by
itself.

### Advertisement

`#advertisement`

An [e-mail](#e-mail) that advertises something, such as an offer from an online
shop. An e-mail is an advertisement only when its [mail_label](#mail_label)
says promotions; an unsubscribe header or a no-reply address never makes it
one, so an invoice is not taken for an advertisement. It is valid for one week
after it arrived, whether or not the [user](#user) was interested; after that
it is [blacklisted](#blacklist). The [server](#server) keeps only its
[sender](#sender), subject, date and mail_label: no
[local copy](#local-copy), no [description](#description), no other
[pipeline](#pipeline) step. It is not read, even from a
[trusted](#trusted) sender.

One [e-mail](#e-mail) whose [mail_label](#mail_label) says promotions is
handled differently: one with an attached PDF. From a [trusted](#trusted)
[sender](#sender) it is read like any other e-mail from that sender; from an
[undecided sender](#undecided-sender) it is only recorded.

### Spam

`#spam`

An unsolicited [e-mail](#e-mail) the [user](#user) does not want. It is an
e-mail whose [mail_label](#mail_label) says spam, or an e-mail from a
[rejected sender](#rejected-sender). Both are told by a rule: no model is used
for spam. Spam is [blacklisted](#blacklist), and it is not read, even from a
[trusted](#trusted) [sender](#sender). The [server](#server) keeps of it what
it keeps of an [advertisement](#advertisement): its sender, subject, date and
mail_label, with no [local copy](#local-copy) and no
[description](#description).

### Attachment

`#attachment`

A PDF or an image attached to an [e-mail](#e-mail). It is indexed as an
[asset](#asset) when the e-mail is read: its [sender](#sender) is
[trusted](#trusted), and its [mail_label](#mail_label) does not keep it from
being read. A picture inside the e-mail's text, such as a logo, is not an attachment.

### Message body

`#message-body`

The text of an [e-mail](#e-mail). It is indexed when the e-mail is read: its
[sender](#sender) is [trusted](#trusted), and its [mail_label](#mail_label)
does not keep it from being read.

## Runs

### Run

`#run`

One pass over a [source](#source). The first run is full; later runs are incremental and
[fetch](#fetching) only what changed.

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

An [asset](#asset) that is no longer in its [source](#source). The row stays, and its `deleted_at` is
set. The word is vanished, because the index never deletes. In search a
vanished asset is hidden by default and shown with a flag.

### Ledger

`#ledger`

What a [run](#run) talks to: it takes the [asset records](#asset-record), keeps the [cursor](#cursor) and
the [checkpoint](#checkpoint), says which [assets](#asset) are unchanged, and marks [vanished](#vanished) assets.
It is the record of what a run saw and where it stopped. Example: a [puller](#puller)
talks to the ledger on the [server](#server) itself; a [collector](#collector) talks to it through
the [API](#api).

### Summary notification

`#summary-notification`

The message sent when a [run](#run) finishes.

### Baseline

`#baseline`

The figures recorded at the first full [run](#run) of a [source](#source) and kept unchanged: what
the user had before organizing and cleaning up. Per source: the
[assets](#asset), the [bytes](#bytes), the [exact](#exact)
[duplicates](#duplicate), the [near](#near) duplicates, and the
[blacklisted](#blacklist) assets, [advertisements](#advertisement) included.
Overall: the number of sources an asset is found in.

## The pipeline

### Pipeline

`#pipeline`

The steps an [asset](#asset) goes through. An [advertisement](#advertisement)
or [spam](#spam) is recorded and goes through none of the later steps, and
neither does an [e-mail](#e-mail) from an
[undecided sender](#undecided-sender).

### Completed steps

`#completed-steps`

Which [pipeline](#pipeline) steps an [asset](#asset) has completed, and with which model.
Example: a scanned receipt has completed every step up to its [OCR text](#ocr-text),
read with one model, and has no [description](#description) yet.

### Discovery

`#discovery`

The [pipeline](#pipeline) step that lists a [source](#source) and sends [asset records](#asset-record).

### Provider hash

`#provider-hash`

A hash the [provider](#provider) reports for an [asset](#asset). It is used to see that an asset is
unchanged without fetching its [bytes](#bytes).

### md5 and sha256

`#md5-and-sha256`

Hashes computed on the [asset](#asset)'s [bytes](#bytes). The sha256 decides
that two assets are [exact](#exact) [duplicates](#duplicate). The md5 is
stored because it is required.

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

Whether the [asset](#asset) has enough [OCR text](#ocr-text) to count as having text.

### Description

`#description`

One English line about an [asset](#asset) of [kind](#kind) `document`.

### doc_date

`#doc_date`

The date printed on the document.

### Issuer

`#issuer`

The institution that issued the document.

### Embedding

`#embedding`

A vector for a photo or for [OCR text](#ocr-text). It lets a search find things by meaning.

## How assets are organized

An [asset](#asset) is described from three independent angles: its
[contexts](#context), its [tags](#tag) and its [doc_type](#doc_type).

### Context

`#context`

The overall situation in the [user](#user)'s life in which an [asset](#asset) is embedded.
An asset has one or more contexts. Examples: personal, professional, a family
album. A team is a context, not a list of [persons](#person). The contexts form the
[taxonomy](#taxonomy).

### Taxonomy

`#taxonomy`

The one structure that organizes the [assets](#asset): the tree of [contexts](#context). The
[user](#user) shapes it.

### Tag

`#tag`

Who or what an [asset](#asset) is about. An asset can have several tags. Tags cut
across the [taxonomy](#taxonomy): they find assets outside of it. A tag is a
[person](#person), a [place](#place) or a tag the [user](#user) made.

What a photo shows is not a tag. A photo of a beach is found by search, which
compares the [user](#user)'s words with what the photo shows. A tag is for what search
cannot know or what the user decides deliberately.

### Person

`#person`

A kind of [tag](#tag): someone the [asset](#asset) is about or shows, from a list the
[user](#user) keeps. An asset can have several persons: a photo with several people,
or a document relevant for two people. The same word is used for a person on a
document and a person recognised in a photo.

### Place

`#place`

A kind of [tag](#tag): a place the [asset](#asset) is about, for example a country. For a
photo it is where the photo was taken. Not to be confused with
[location](#location), which is the kind of [source](#source).

### doc_type

`#doc_type`

What kind of document it is, from a fixed English vocabulary such as `tax` or
`invoice`. An [asset](#asset) of [kind](#kind) `document` has one; no other asset has any.
The [context](#context) says which part of the [user](#user)'s life an asset belongs to and
the doc_type says which kind of paper it is, so the same fact is never held in
both. On the command line the flag is `--doc-type`.

## Duplicates

### Duplicate

`#duplicate`

An [asset](#asset) that is the same as another asset. The word is always written out.
`dups` exists only as the name of a command.

### Duplicate group

`#duplicate-group`

[Assets](#asset) that are the same. A group is [exact](#exact) or [near](#near), and an
asset is in one group only. Assets showing the same image are one group; it is
exact when all [bytes](#bytes) match, otherwise near.

### Exact

`#exact`

The same [bytes](#bytes), told by the same [sha256](#md5-and-sha256).

### Near

`#near`

The same image at another resolution or in another format. The word is used
only for [duplicates](#duplicate).

### Keeper

`#keeper`

The [asset](#asset) suggested to keep in a [duplicate group](#duplicate-group).

### Non-keeper

`#non-keeper`

Every other [asset](#asset) in the [group](#duplicate-group).

### Reviewed

`#reviewed`

Set by the [user](#user) on a [duplicate group](#duplicate-group). Until then the [keeper](#keeper) is only a
suggestion.

### Duplicate report

`#duplicate-report`

The web page that shows [duplicate groups](#duplicate-group) with thumbnails side by side, where
the [user](#user) changes a [keeper](#keeper) and marks a group [reviewed](#reviewed).

## Search

### Match

`#match`

One entry in a search answer: an [asset](#asset) that matches the search. Example: a
search for words printed on a receipt answers with one match for each asset
whose text holds those words.

## Words we do not use

`#words-we-do-not-use`

| Not this | But this | Why |
|---|---|---|
| scan, for a pass over a [source](#source) | [run](#run) | A scan is a scanned paper. |
| document, photo, [attachment](#attachment) as units | [asset](#asset) | The asset is the only unit. Document and photo are its [kind](#kind). |
| cloud | [source](#source), [location](#location), [provider](#provider) | "Cloud" is not a term. |
| owner, for the machine that [fetches](#fetching) a [source](#source) | [reader](#reader) | "Owner" reads as a person. The machine is the reader. |
| read, for what is done with a [source](#source) | [fetch](#fetching) | A source is fetched. Only an [asset](#asset) is read, and only by the [guardian](#guardian). |
| type | [kind](#kind), [doc_type](#doc_type), [ext](#ext) | "Type" meant three things. |
| deleted, for an [asset](#asset) that is gone from its [source](#source) | [vanished](#vanished) | The index never deletes. Only what is in the [quarantine](#quarantine) is deleted. |
| a whitelisted or blacklisted [sender](#sender) | a [whitelisted](#whitelist) or [blacklisted](#blacklist) [asset](#asset) | The verdict is on the asset. A sender is [trusted](#trusted), [undecided](#undecided-sender) or [rejected](#rejected-sender). |
| a trusted [asset](#asset) | an [asset](#asset) from a [trusted](#trusted) [source](#source) or [sender](#sender) | Trusted is about where an asset comes from, not about the asset. |
| backend, or the machine's model name | [server](#server) | One word for the machine. |
| label, for what the [provider](#provider) says about an [e-mail](#e-mail) | [mail_label](#mail_label) | "Label" is loose. An unsubscribe header is not a mail_label. |
| content | [bytes](#bytes) | One word. |
| dup, dups | [duplicate](#duplicate) | `dups` is only a command's name. |
| near, for geography | [place](#place) | Near is for [duplicates](#duplicate). Searching photos near a place is not part of the index item. |
| temp directory | [stash](#stash) | [Assets](#asset) are no longer fetched and thrown away: the [server](#server) keeps a [local copy](#local-copy) of each. |
