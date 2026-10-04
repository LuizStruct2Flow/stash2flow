# Principles

The rules that hold everywhere in stash2flow, whatever part of the app is being
built. Read this before proposing a feature or reviewing one: a design that
breaks one of these is wrong, however well it works.

## Nothing deleted without a go

`#nothing-deleted-without-a-go`

No content is deleted or moved without the [user](domain-language.md#user)'s go.
The app never deletes or moves anything by itself.

- The index only reports. It groups [duplicates](domain-language.md#duplicate)
  and suggests which [file](domain-language.md#file) to keep; it removes
  nothing.
- A file that is gone from its [source](domain-language.md#source) is not
  deleted from the index either. Its row stays and is marked as
  [vanished](domain-language.md#vanished).
- When the app later cleans up [sources](domain-language.md#source)
  ([FEATURE-002](../backlog/BACKLOG.md)), a [file](domain-language.md#file) is
  removed from a source only after explicit confirmation, and only when its
  [bytes](domain-language.md#bytes) are verified, by hash, both on the
  [server](domain-language.md#server) and in the clean copy.

## The user decides

`#the-user-decides`

The [user](domain-language.md#user) decides what matters. The app only proposes.

The choices that are the [user](domain-language.md#user)'s:

| Choice | What the app does |
|---|---|
| The [order of sources](domain-language.md#order-of-sources) | Uses it to suggest a [keeper](domain-language.md#keeper) in each [duplicate group](domain-language.md#duplicate-group). |
| The [keeper](domain-language.md#keeper) of a [duplicate group](domain-language.md#duplicate-group) | Suggests one. Nothing counts as chosen until the [user](domain-language.md#user) marks the group [reviewed](domain-language.md#reviewed). |
| The [whitelist](domain-language.md#whitelist) and [blacklist](domain-language.md#blacklist) of [senders](domain-language.md#sender) | Reports hints about each sender. The [user](domain-language.md#user) sorts. |
| Starting a [run](domain-language.md#run) | Starts one by itself only 30 days after the [source](domain-language.md#source)'s last finished run. |
| Running a new [pipeline](domain-language.md#pipeline) step over [files](domain-language.md#file) already indexed | Does it only when asked. |

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

## A local copy of every file

`#a-local-copy-of-every-file`

The [server](domain-language.md#server) keeps a
[local copy](domain-language.md#local-copy) of every
[file](domain-language.md#file) it indexes.

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
  [file](domain-language.md#file) is downloaded twice.
- A Mac [collector](domain-language.md#collector) uploads the
  [bytes](domain-language.md#bytes) of every [file](domain-language.md#file) it
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
and a [run](domain-language.md#run) only reads.

The first thing that will ever write to a [source](domain-language.md#source) is
the clean-up step ([FEATURE-002](../backlog/BACKLOG.md)), under the rule
[nothing deleted without a go](#nothing-deleted-without-a-go).

The photo library on a Mac is never read directly. It is read only through the
command-line program `osxphotos`.

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
[persons](domain-language.md#person), [senders](domain-language.md#sender),
keywords, model names and the model server's address are configuration or data.
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
