# Infrastructure

What stash2flow runs on: the server, the database, the model server, the
backup, and how the server is protected. Read this to install the app, or to
judge whether a change is safe for the data it holds.

## Server setup

`#server-setup`

One local machine, the [server](domain-language.md#server), runs everything
except the Mac [collector](domain-language.md#collector): the database, the
[API](domain-language.md#api), the [pullers](domain-language.md#puller), the
[guardian](domain-language.md#guardian), the
[workers](domain-language.md#worker) and the
[scheduler](domain-language.md#scheduler). There are no cloud accounts and no
cloud resources.

- The server is reachable only on the local network, or through a VPN.
- It installs from the repository on any Linux machine with PostgreSQL. The
  setup lives in `infra/` as code, so the machine can be rebuilt from the
  repository.
- The Mac collector is optional. Where it is used, the Mac's own scheduler
  (`launchd`) starts its [runs](domain-language.md#run).

How the [server](domain-language.md#server)'s parts are installed and kept
running is open:
[open question: server setup](open-questions.md#question-server-setup). Today
`infra/` defines the database only; see its
[README](../../infra/README.md).

## Expected volume

`#expected-volume`

The app is designed for tens of thousands of [assets](domain-language.md#asset),
possibly more than 100,000. Slice 1 of the plan measures files per hour for OCR
and for both embeddings and extends the figure to 100,000 files, so the length
of the first full [run](domain-language.md#run) is known before it starts.

## Database

`#database`

PostgreSQL with three extensions:

| Extension | Used for |
|---|---|
| `pgvector` | searching by embedding |
| `unaccent` | searching without accents |
| `pg_trgm` | tolerating OCR misreadings |

One system does full-text search, filters, vector similarity and hash matching.
The relationships in the data ([duplicate groups](domain-language.md#duplicate-group),
[persons](domain-language.md#person)) are simple enough for tables, which is
why there is no graph database.

The database holds things a [run](domain-language.md#run) cannot rebuild: the
[user](domain-language.md#user)'s choices
([reviewed](domain-language.md#reviewed) groups,
[keepers](domain-language.md#keeper), the
[order of sources](domain-language.md#order-of-sources), the rules that make
an [asset](domain-language.md#asset)
[whitelisted](domain-language.md#whitelist) by default, which
[senders](domain-language.md#sender) are
[trusted](domain-language.md#trusted) and which are
[rejected](domain-language.md#rejected-sender)) and the
[baseline](domain-language.md#baseline). That is why it is backed up.

## Model server

`#model-server`

A program on the [user](domain-language.md#user)'s network that serves a local
language model, such as Ollama or the llama.cpp server. The app calls it for
[descriptions](domain-language.md#description), and for OCR only if the
benchmark picks a vision model. The other models run inside the app's own
process.

Its address is configuration and must be a local one. Details are in
[where models run](architecture.md#where-models-run).

## Token store

`#token-store`

The access tokens for the [providers](domain-language.md#provider) are stored
encrypted, in a file on the [server](domain-language.md#server). Every
permission asked of a provider is read-only.

## Logs

`#logs`

Logs are written on the [server](domain-language.md#server).
[Runs](domain-language.md#run) and their errors are stored in the database and
can be queried. A [summary notification](domain-language.md#summary-notification)
is sent when a run finishes. Nothing about observing the app runs in a hosted
service.

## Backup

`#backup`

The backup goes to iCloud. It is encrypted before it leaves the
[server](domain-language.md#server).

- The app builds nothing for backup. `infra/` ships one script.
- It covers the database, the configuration file and the token store.
- Backup is the installer's own tool: someone with other infrastructure
  replaces the script.

How the encrypted file gets from a Linux server to iCloud is open:
[open question: backup transport](open-questions.md#question-backup-transport).

## Disk encryption

`#disk-encryption`

The [server](domain-language.md#server)'s disk holds a
[local copy](domain-language.md#local-copy) of every private document, so it must be
encrypted.

**Today it is not.** No real document is indexed until that is solved. The
question for the founder is
[open question: disk encryption](open-questions.md#question-disk-encryption).

## Authentication

`#authentication`

The [API](domain-language.md#api) refuses a call without valid credentials.
Everything that calls it authenticates: the
[collectors](domain-language.md#collector), the command line, and the browser
that opens the [duplicate report](domain-language.md#duplicate-report).

- Each client has its own token.
- The [API](domain-language.md#api) is served over HTTPS on the local network.

## Isolation of reading

`#isolation-of-reading`

The [guardian](domain-language.md#guardian) is the part of the app that takes
text and pictures out of an [asset](domain-language.md#asset). It runs so that
a deliberately crafted file that breaks the reading library reaches nothing.
That is a requirement on the installation, on the
[server](domain-language.md#server) and on a Mac, whatever it is made with:

| The [guardian](domain-language.md#guardian), while it reads | |
|---|---|
| gets | the [bytes](domain-language.md#bytes) of the [asset](domain-language.md#asset) it reads |
| gives back | text, pictures and metadata |
| cannot reach | the network: not the internet, not the local network, not the [model server](#model-server) |
| cannot reach | the [token store](#token-store), which holds the [providers](domain-language.md#provider)' access tokens |
| cannot reach | the [database](#database) or its credentials |
| never does | run a macro, a script or an executable found inside an [asset](domain-language.md#asset) |

- It holds for every [asset](domain-language.md#asset), also one from a
  [trusted](domain-language.md#trusted) [source](domain-language.md#source) or
  [sender](domain-language.md#sender).
- The setup that enforces it lives in `infra/` as code, like the rest of the
  [server](domain-language.md#server) setup, and a test proves that the
  [guardian](domain-language.md#guardian) cannot reach the network.
- The same holds on a Mac, because a
  [collector](domain-language.md#collector) works with files there: where the
  inside of an [asset](domain-language.md#asset) is needed, the
  [guardian](domain-language.md#guardian) reads it in the same isolation.

With what it is made, on the [server](domain-language.md#server) and on a Mac,
is open:
[open question: how reading is isolated](open-questions.md#question-how-reading-is-isolated).
The code's side of it is
[reading in isolation](architecture.md#reading-in-isolation).

## Sensitive data

`#sensitive-data`

What the [server](domain-language.md#server) holds and must protect:

- tax ids and identity documents, in the
  [OCR text](domain-language.md#ocr-text) and in the
  [local copies](domain-language.md#local-copy);
- [e-mail](domain-language.md#e-mail) text and
  [senders](domain-language.md#sender);
- photos with coordinates and [persons](domain-language.md#person);
- the [providers](domain-language.md#provider)' access tokens;
- the encrypted backups.

Who it is protected against: another device on the local network, a stolen
[server](domain-language.md#server) disk or backup, a leaked token, and a
deliberately crafted file among the [assets](domain-language.md#asset)
([isolation of reading](#isolation-of-reading)).
