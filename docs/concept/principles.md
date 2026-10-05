# Principles

The rules that hold everywhere in stash2flow, whatever part of the app is being
built. Read this before proposing a feature or reviewing one: a design that
breaks one of these is wrong, however well it works.

## Nothing deleted without a go

`#nothing-deleted-without-a-go`

Nothing is deleted permanently without the [user](domain-language.md#user)'s
go. The [quarantine](domain-language.md#quarantine) is how he gives or
withholds it.

- **Whatever could be deleted is moved to the
  [quarantine](domain-language.md#quarantine) first.** Moving an
  [asset](domain-language.md#asset) there does not need a go for each asset.
- **There is one [quarantine](domain-language.md#quarantine) for all
  [sources](domain-language.md#source).** The
  [user](domain-language.md#user) looks through it in the app, in one place. He
  never has to open each mailbox or drive to see what is about to be deleted.
- **In the [quarantine](domain-language.md#quarantine) the
  [user](domain-language.md#user) decides.** He can look through it, restore an
  [asset](domain-language.md#asset) or delete it permanently. Restoring is his
  no. Deleting it, or leaving it there, is his go: everything in the quarantine
  is deleted permanently after 30 days unless it is restored, with no
  exception.
- **Only a rule moves an [asset](domain-language.md#asset) to the
  [quarantine](domain-language.md#quarantine).** An asset is
  [blacklisted](domain-language.md#blacklist) by a rule: an
  [advertisement](domain-language.md#advertisement) past its week, an
  [e-mail](domain-language.md#e-mail) whose
  [mail_label](domain-language.md#mail_label) says spam, an e-mail from a
  [rejected sender](domain-language.md#rejected-sender). No model blacklists
  an asset, so everything in the quarantine was put there by a rule and follows
  the 30 days.
- **An [asset](domain-language.md#asset) worth keeping is removed from a
  [source](domain-language.md#source) only when verified copies exist**: its
  [bytes](domain-language.md#bytes) are verified, by hash, both on the
  [server](domain-language.md#server) and in the clean copy. An
  [advertisement](domain-language.md#advertisement) and
  [spam](domain-language.md#spam) have no
  [local copy](domain-language.md#local-copy), and that is intended: they are
  on their way out.
- **The index deletes nothing and moves nothing.** It records whether an
  [asset](domain-language.md#asset) is
  [whitelisted](domain-language.md#whitelist),
  [blacklisted](domain-language.md#blacklist) or neither, groups
  [duplicates](domain-language.md#duplicate) and suggests which asset to keep.
  The quarantine belongs to clean-up ([FEATURE-002](../backlog/BACKLOG.md)),
  which is parked.
- An [asset](domain-language.md#asset) that is gone from its
  [source](domain-language.md#source) is not deleted from the index either. Its
  row stays and is marked as [vanished](domain-language.md#vanished).

## The user decides

`#the-user-decides`

The [user](domain-language.md#user) decides what matters. The app only proposes.

The choices that are the [user](domain-language.md#user)'s:

| Choice | What the app does |
|---|---|
| The [order of sources](domain-language.md#order-of-sources) | Uses it to suggest a [keeper](domain-language.md#keeper) in each [duplicate group](domain-language.md#duplicate-group). |
| The [keeper](domain-language.md#keeper) of a [duplicate group](domain-language.md#duplicate-group) | Suggests one. Nothing counts as chosen until the [user](domain-language.md#user) marks the group [reviewed](domain-language.md#reviewed). |
| Which [senders](domain-language.md#sender) are [trusted](domain-language.md#trusted) | Trusts a sender the [user](domain-language.md#user) has written to himself. Lists every [undecided sender](domain-language.md#undecided-sender); he says once per sender whether he trusts it. Until then the app only records that sender's [e-mails](domain-language.md#e-mail). A sender he says no to is a [rejected sender](domain-language.md#rejected-sender), and its e-mails are [blacklisted](domain-language.md#blacklist) by a rule. |
| Which [assets](domain-language.md#asset) are [whitelisted](domain-language.md#whitelist) by default | Applies rules from where the asset came from. Who keeps the rules is open: [open question: whitelisted by default](open-questions.md#question-whitelisted-by-default). |
| What is restored from the [quarantine](domain-language.md#quarantine) and what is deleted | Moves there whatever could be deleted, such as a [blacklisted](domain-language.md#blacklist) [asset](domain-language.md#asset). After 30 days it deletes what the [user](domain-language.md#user) left there. |
| Starting a [run](domain-language.md#run) | Starts one by itself only 30 days after the [source](domain-language.md#source)'s last finished run. |
| Running a new [pipeline](domain-language.md#pipeline) step over [assets](domain-language.md#asset) already indexed | Does it only when asked. |

## Private by construction

`#private-by-construction`

No document text and no image leaves the [user](domain-language.md#user)'s
network.

- The [server](domain-language.md#server) is reachable only on the local
  network, or through a VPN.
- The heavy and private work (reading text from pages, describing documents,
  computing [embeddings](domain-language.md#embedding)) runs on the server.
- The index holds sensitive personal data, such as tax ids and identity
  documents. The database stays on hardware the
  [user](domain-language.md#user) controls.
- A backup is encrypted before it leaves the
  [server](domain-language.md#server). See
  [backup](infrastructure.md#backup).
- The figures the app records about the [user](domain-language.md#user)'s own
  case are never published by the app.

## Local models only

`#local-models-only`

Every model the app uses runs locally: inside the app's own process, or at a
model server on the [user](domain-language.md#user)'s network. The app ships no
setting for a model outside the user's network: there is no key and no switch.

The address of the model server must be a local one. Any other address is
refused when the app starts. See
[where models run](architecture.md#where-models-run).

A consequence: the app has no billable path. Someone who wants a hosted model
writes that adapter himself, and it then needs budget caps and spend logging.

## Deterministic code first

`#deterministic-code-first`

The app works with deterministic, tested code. A model is used for three things
only: to understand an [asset](domain-language.md#asset), to classify it, and
to help develop the [taxonomy](domain-language.md#taxonomy). Everything else is
code that gives the same answer every time and is covered by tests.

Whoever proposes a model for a piece of work first answers one question: why
can deterministic code not do this? If code can do it, code does it.

Where a model is used, and why code cannot do it:

| Work | Why not code |
|---|---|
| Reading the text of a scan ([OCR text](domain-language.md#ocr-text)) | Turning pixels into text has no rule set. |
| Writing the [description](domain-language.md#description) and finding the [doc_type](domain-language.md#doc_type), the [issuer](domain-language.md#issuer) and the [persons](domain-language.md#person) | It means understanding free text in several languages. Rules would need a pattern for every issuer and every layout. |
| Choosing the [doc_date](domain-language.md#doc_date) | Code can find every date printed on a page. Which one is the document's own date needs understanding. |
| [Embeddings](domain-language.md#embedding), for search by meaning and by what a photo shows | Similarity of meaning cannot be written as rules. |
| Proposing a [context](domain-language.md#context) for an asset that no rule covers | Rules from the [source](domain-language.md#source), the folder and the [sender](domain-language.md#sender) come first. A model proposes only for what is left. |
| Helping develop the taxonomy | It is a judgement about one person's life. |

What a model never does:

- **It never decides an action.** What is deleted permanently, which
  [keeper](domain-language.md#keeper) wins and whether a
  [duplicate group](domain-language.md#duplicate-group) is
  [reviewed](domain-language.md#reviewed) are the
  [user](domain-language.md#user)'s decisions, carried out by code.
- **It never [blacklists](domain-language.md#blacklist) an
  [asset](domain-language.md#asset), and it is not used for
  [spam](domain-language.md#spam).** Spam is an
  [e-mail](domain-language.md#e-mail) whose
  [mail_label](domain-language.md#mail_label) says spam, or an e-mail from a
  [rejected sender](domain-language.md#rejected-sender). Both are rules.
- **It never does what a rule can do.** [Fetching](domain-language.md#fetching),
  the hashes, [exact](domain-language.md#exact) and
  [near](domain-language.md#near) duplicates, [kind](domain-language.md#kind),
  the [asset_date](domain-language.md#asset_date), telling an
  [advertisement](domain-language.md#advertisement) by the
  [mail_label](domain-language.md#mail_label), the advertisement's week of
  validity, who is [trusted](domain-language.md#trusted), the
  rules that make an asset [whitelisted](domain-language.md#whitelist) by
  default, the 30 days of the quarantine, when a
  [run](domain-language.md#run) starts, and the
  [baseline](domain-language.md#baseline) are all code.
- **Its output is checked by code.** A doc_type outside the vocabulary, a
  description longer than one line, a person who is not on the user's list or a
  date that is not printed in the text is refused.

This is also what limits text inside an [asset](domain-language.md#asset) that
tries to instruct a model. The model decides no action and its output is
checked by code, so at worst the asset gets a wrong
[description](domain-language.md#description).

## The app reads what it trusts, in isolation, and runs nothing

`#the-app-reads-what-it-trusts-in-isolation-and-runs-nothing`

Reading an [asset](domain-language.md#asset) means taking its text and pictures
out, so the app knows what is inside. Running it means letting code inside it
execute. The app does the first and never the second.

- **It runs nothing.** No macro, no script and no executable inside an
  [asset](domain-language.md#asset) is ever executed.
- **It reads what it trusts.** The [guardian](domain-language.md#guardian)
  decides whether an [asset](domain-language.md#asset) may be read, by whether
  where it comes from is [trusted](domain-language.md#trusted): the
  [user](domain-language.md#user)'s own drives and photo libraries, and an
  [e-mail](domain-language.md#e-mail) from a
  [sender](domain-language.md#sender) he has written to himself or has marked
  as trusted. Of any other e-mail the app records the sender, subject, date and
  [mail_label](domain-language.md#mail_label) only. Who is trusted is a rule in
  code, never a model's guess: [who is trusted](sources.md#who-is-trusted).
- **The [mail_label](domain-language.md#mail_label) is applied before trust.**
  An [e-mail](domain-language.md#e-mail) whose mail_label says promotions or
  spam is not read, even from a [trusted](domain-language.md#trusted)
  [sender](domain-language.md#sender). The one exception is an e-mail with an
  attached PDF whose mail_label says promotions: from a trusted sender it is
  read like any other e-mail from that sender, and from an
  [undecided sender](domain-language.md#undecided-sender) it is only recorded.
- **It reads in isolation.** The [guardian](domain-language.md#guardian) reads
  an [asset](domain-language.md#asset) with no network access and no access to
  the [providers](domain-language.md#provider)' access tokens or to the
  database. A deliberately crafted file that breaks the reading library
  reaches nothing. See
  [reading in isolation](architecture.md#reading-in-isolation).
- **Nothing else touches the inside of an
  [asset](domain-language.md#asset).** Only the
  [guardian](domain-language.md#guardian) takes text and pictures out of one.
- **The isolation applies on a Mac too.** A
  [collector](domain-language.md#collector) works with files there, and where
  the inside of an [asset](domain-language.md#asset) is needed on the Mac, the
  [guardian](domain-language.md#guardian) reads it in the same isolation.
- **While reading an [e-mail](domain-language.md#e-mail) it loads nothing from
  the internet**: no remote images and no following of links. Only the text and
  the [attachments](domain-language.md#attachment).

Isolation stays although trust already decides what is read. Trust is about
where an [asset](domain-language.md#asset) comes from, not about its
[bytes](domain-language.md#bytes): a [trusted](domain-language.md#trusted)
[sender](domain-language.md#sender) can be compromised, and the
[user](domain-language.md#user)'s own drives hold files that once came from
places that are not trusted.

Trusted is not a verdict. Whether an [asset](domain-language.md#asset) is
[whitelisted](domain-language.md#whitelist) or
[blacklisted](domain-language.md#blacklist) is decided about the asset itself,
after it was read or recorded.

## A local copy of every asset

`#a-local-copy-of-every-asset`

The [server](domain-language.md#server) keeps a
[local copy](domain-language.md#local-copy) of every
[asset](domain-language.md#asset) it indexes fully.

"Every" has one exception, and it is deliberate: an
[advertisement](domain-language.md#advertisement) and
[spam](domain-language.md#spam) have no
[local copy](domain-language.md#local-copy). They are on their way out, so the
[server](domain-language.md#server) keeps only their
[sender](domain-language.md#sender), subject, date and
[mail_label](domain-language.md#mail_label).

An [e-mail](domain-language.md#e-mail) from an
[undecided sender](domain-language.md#undecided-sender) is not indexed fully,
so it has no
[local copy](domain-language.md#local-copy) either: the
[server](domain-language.md#server) keeps the same four things of it.

The reason is where the [user](domain-language.md#user) wants to end up: once
everything is organized, he cleans his cloud drives and keeps one clean copy. A
[source](domain-language.md#source) can only be cleaned when a verified copy
exists elsewhere, so the copies start with the index.

What follows from it:

- The [local copies](domain-language.md#local-copy) are kept in the
  [stash](domain-language.md#stash) on the
  [server](domain-language.md#server), addressed by
  [sha256](domain-language.md#md5-and-sha256), so the same
  [bytes](domain-language.md#bytes) arriving from two
  [sources](domain-language.md#source) are stored once.
- Later [pipeline](domain-language.md#pipeline) steps read from the
  [local copy](domain-language.md#local-copy). No
  [asset](domain-language.md#asset) is downloaded twice.
- A Mac [collector](domain-language.md#collector) uploads the
  [bytes](domain-language.md#bytes) of every [asset](domain-language.md#asset) it
  reports. It does not wait to be asked.
- The [server](domain-language.md#server)'s disk now holds every private
  document, so it must be encrypted:
  [disk encryption](infrastructure.md#disk-encryption).

Whether videos are copied too is open, because they may be large:
[open question: videos](open-questions.md#question-videos).

## Read-only on sources

`#read-only-on-sources`

The index never writes to a [source](domain-language.md#source). Every
permission it asks a [provider](domain-language.md#provider) for is read-only,
and a [run](domain-language.md#run) only
[fetches](domain-language.md#fetching).

The first thing that will ever write to a [source](domain-language.md#source) is
the clean-up step ([FEATURE-002](../backlog/BACKLOG.md)), under the rule
[nothing deleted without a go](#nothing-deleted-without-a-go). Moving an
[asset](domain-language.md#asset) to the
[quarantine](domain-language.md#quarantine) is such a write, so the index never
does it: it only records whether an asset is
[whitelisted](domain-language.md#whitelist) or
[blacklisted](domain-language.md#blacklist).

The photo library on a Mac is never opened directly. It is
[fetched](domain-language.md#fetching) only through the command-line program
`osxphotos`.

## Open source

`#open-source`

The app is open source under the MIT licence, for people with other
infrastructure and other [sources](domain-language.md#source) than the
founder's.

What that binds:

1. A new kind of [source](domain-language.md#source) is a new adapter and a
   configuration entry, with no change to the domain or the use-cases. See
   [adding a source](sources.md#adding-a-source).
2. Nothing about one installation is in the code. See
   [nothing about one installation](#nothing-about-one-installation).
3. Which model does a step is configuration: a model name for models inside the
   app's process, an address for the model server.
4. The [server](domain-language.md#server) installs from the repository on any
   Linux machine with PostgreSQL. The Mac
   [collector](domain-language.md#collector) is optional.
5. Backup is the installer's own tool. The app builds nothing for it.

There is no plug-in system. The ports are the extension point. See
[ports and adapters](architecture.md#ports-and-adapters).

The copyright line of the licence file is still open:
[open question: copyright line](open-questions.md#question-copyright-line).

## Nothing about one installation

`#nothing-about-one-installation`

[Sources](domain-language.md#source), [accounts](domain-language.md#account),
[persons](domain-language.md#person), [senders](domain-language.md#sender) and
which of them are [trusted](domain-language.md#trusted) or
[rejected](domain-language.md#rejected-sender),
the rules that make an [asset](domain-language.md#asset)
[whitelisted](domain-language.md#whitelist) by default, model names and the model server's address are configuration or data.
They live outside the repository. None of them is written into the code.

## Public repository

`#public-repository`

The repository is public on GitHub. No tracked file may carry a
[user](domain-language.md#user)'s [account](domain-language.md#account) data: no
account names or addresses, no personal names, no folder or file names from his
[sources](domain-language.md#source), no machine names, no real document titles.
Examples and test fixtures in tracked files are invented.

The founder's original specification is private and is not in the repository.
These concept documents and the feature files are the public statement of what
the app does, so they must be complete without it.

How this is checked mechanically is open:
[open question: public repository check](open-questions.md#question-public-repository-check).
