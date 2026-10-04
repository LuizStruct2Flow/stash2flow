# Principles

The rules that hold everywhere in stash2flow, whatever part of the app is being
built. Read this before proposing a feature or reviewing one: a design that
breaks one of these is wrong, however well it works.

## Nothing deleted without a go

`#nothing-deleted-without-a-go`

No content is deleted or moved without the user's go. The app never deletes or
moves anything by itself.

- The index only reports. It groups duplicates and suggests which file to keep;
  it removes nothing.
- A file that is gone from its source is not deleted from the index either. Its
  row stays and is marked as [#vanished](domain-language.md#vanished).
- When the app later cleans up sources
  ([FEATURE-002](../backlog/BACKLOG.md)), a file is removed from a source only
  after explicit confirmation, and only when its bytes are verified, by hash,
  both on the server and in the clean copy.

## The user decides

`#the-user-decides`

The user decides what matters. The app only proposes.

The choices that are the [#user](domain-language.md#user)'s:

| Choice | What the app does |
|---|---|
| The [#order-of-sources](domain-language.md#order-of-sources) | Uses it to suggest a keeper in each duplicate group. |
| The [#keeper](domain-language.md#keeper) of a duplicate group | Suggests one. Nothing counts as chosen until the user marks the group [#reviewed](domain-language.md#reviewed). |
| The [#whitelist](domain-language.md#whitelist) and [#blacklist](domain-language.md#blacklist) of senders | Reports hints about each sender. The user sorts. |
| Starting a [#run](domain-language.md#run) | Starts one by itself only 30 days after the source's last finished run. |
| Running a new pipeline step over files already indexed | Does it only when asked. |

## Private by construction

`#private-by-construction`

No document text and no image leaves the user's network.

- The server is reachable only on the local network, or through a VPN.
- The heavy and private work (reading text from pages, describing documents,
  computing embeddings) runs on the server.
- The index holds sensitive personal data, such as tax ids and identity
  documents. The database stays on hardware the user controls.
- A backup is encrypted before it leaves the server. See
  [#backup](infrastructure.md#backup).
- The figures the app records about the user's own case are never published by
  the app.

## Local models only

`#local-models-only`

Every model the app uses runs locally: inside the app's own process, or at a
model server on the user's network. The app ships no setting for a model
outside the user's network: there is no key and no switch.

The address of the model server must be a local one. Any other address is
refused when the app starts. See
[#where-models-run](architecture.md#where-models-run).

A consequence: the app has no billable path. Someone who wants a hosted model
writes that adapter himself, and it then needs budget caps and spend logging.

## Local copy

`#local-copy`

The server keeps a local copy of every file it indexes.

The reason is where the user wants to end up: once everything is organized, he
cleans his cloud drives and keeps one clean copy. A source can only be cleaned
when a verified copy exists elsewhere, so the copies start with the index.

What follows from it:

- The copies are kept in one store on the server, addressed by sha256, so the
  same bytes arriving from two sources are stored once.
- Later pipeline steps read from the local copy. No file is downloaded twice.
- A Mac collector uploads the bytes of every file it reports. It does not wait
  to be asked.
- The server's disk now holds every private document, so it must be encrypted:
  [#disk-encryption](infrastructure.md#disk-encryption).

Whether videos are copied too is open, because they may be large:
[#question-videos](open-questions.md#question-videos).

## Read-only on sources

`#read-only-on-sources`

The index never writes to a source. Every permission it asks a provider for is
read-only, and a run only reads.

The first thing that will ever write to a source is the clean-up step
([FEATURE-002](../backlog/BACKLOG.md)), under the rule
[#nothing-deleted-without-a-go](#nothing-deleted-without-a-go).

The photo library on a Mac is never read directly. It is read only through the
command-line program `osxphotos`.

## Open source

`#open-source`

The app is open source under the MIT licence, for people with other
infrastructure and other sources than the founder's.

What that binds:

1. A new kind of source is a new adapter and a configuration entry, with no
   change to the domain or the use-cases. See
   [#adding-a-source](sources.md#adding-a-source).
2. Nothing about one installation is in the code. See
   [#nothing-about-one-installation](#nothing-about-one-installation).
3. Which model does a step is configuration: a model name for models inside the
   app's process, an address for the model server.
4. The server installs from the repository on any Linux machine with
   PostgreSQL. The Mac collector is optional.
5. Backup is the installer's own tool. The app builds nothing for it.

There is no plug-in system. The ports are the extension point. See
[#ports-and-adapters](architecture.md#ports-and-adapters).

The copyright line of the licence file is still open:
[#question-copyright-line](open-questions.md#question-copyright-line).

## Nothing about one installation

`#nothing-about-one-installation`

Sources, accounts, persons, senders, keywords, model names and the model
server's address are configuration or data. They live outside the repository.
None of them is written into the code.

## Public repository

`#public-repository`

The repository is public on GitHub. No tracked file may carry a user's account
data: no account names or addresses, no personal names, no folder or file names
from his sources, no machine names, no real document titles. Examples and test
fixtures in tracked files are invented.

The founder's original specification is private and is not in the repository.
These concept documents and the feature files are the public statement of what
the app does, so they must be complete without it.

How this is checked mechanically is open:
[#question-public-repository-check](open-questions.md#question-public-repository-check).
