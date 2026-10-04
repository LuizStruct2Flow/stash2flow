# Infrastructure

What stash2flow runs on: the server, the database, the model server, the
backup, and how the server is protected. Read this to install the app, or to
judge whether a change is safe for the data it holds.

## Server setup

`#server-setup`

One local machine, the [server](domain-language.md#server), runs everything
except the Mac [collector](domain-language.md#collector): the database, the
[API](domain-language.md#api), the [pullers](domain-language.md#puller), the
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

The app is designed for tens of thousands of [files](domain-language.md#file),
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
[order of sources](domain-language.md#order-of-sources), the
[whitelist](domain-language.md#whitelist) and the
[blacklist](domain-language.md#blacklist)) and the
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

The [API](domain-language.md#api) refuses a call without valid credentials. That
holds for the [collectors](domain-language.md#collector), and for the
[duplicate report](domain-language.md#duplicate-report), which takes changes
from the [user](domain-language.md#user) and therefore cannot be open.

Who else must authenticate, and how, is open:
[open question: authentication](open-questions.md#question-authentication).

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
[server](domain-language.md#server) disk or backup, and a leaked token.
