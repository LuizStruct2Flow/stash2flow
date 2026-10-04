# Infrastructure

What stash2flow runs on: the server, the database, the model server, the
backup, and how the server is protected. Read this to install the app, or to
judge whether a change is safe for the data it holds.

## Server setup

`#server-setup`

One local machine, the [#server](domain-language.md#server), runs everything
except the Mac collector: the database, the API, the pullers, the workers and
the scheduler. There are no cloud accounts and no cloud resources.

- The server is reachable only on the local network, or through a VPN.
- It installs from the repository on any Linux machine with PostgreSQL. The
  setup lives in `infra/` as code, so the machine can be rebuilt from the
  repository.
- The Mac collector is optional. Where it is used, the Mac's own scheduler
  (`launchd`) starts its runs.

How the server's parts are installed and kept running is open:
[#question-server-setup](open-questions.md#question-server-setup). Today
`infra/` defines the database only; see its
[README](../../infra/README.md).

## Expected volume

`#expected-volume`

The app is designed for tens of thousands of files, possibly more than
100,000. Slice 1 of the plan measures files per hour for OCR and for both
embeddings and extends the figure to 100,000 files, so the length of the first
full run is known before it starts.

## Database

`#database`

PostgreSQL with three extensions:

| Extension | Used for |
|---|---|
| `pgvector` | searching by embedding |
| `unaccent` | searching without accents |
| `pg_trgm` | tolerating OCR misreadings |

One system does full-text search, filters, vector similarity and hash matching.
The relationships in the data (duplicate groups, persons) are simple enough for
tables, which is why there is no graph database.

The database holds things a run cannot rebuild: the user's choices (reviewed
groups, keepers, the order of sources, the whitelist and the blacklist) and the
baseline. That is why it is backed up.

## Model server

`#model-server`

A program on the user's network that serves a local language model, such as
Ollama or the llama.cpp server. The app calls it for descriptions, and for OCR
only if the benchmark picks a vision model. The other models run inside the
app's own process.

Its address is configuration and must be a local one. Details are in
[#where-models-run](architecture.md#where-models-run).

## Token store

`#token-store`

The access tokens for the providers are stored encrypted, in a file on the
server. Every permission asked of a provider is read-only.

## Logs

`#logs`

Logs are written on the server. Runs and their errors are stored in the
database and can be queried. A summary notification is sent when a run
finishes. Nothing about observing the app runs in a hosted service.

## Backup

`#backup`

The backup goes to iCloud. It is encrypted before it leaves the server.

- The app builds nothing for backup. `infra/` ships one script.
- It covers the database, the configuration file and the token store.
- Backup is the installer's own tool: someone with other infrastructure
  replaces the script.

How the encrypted file gets from a Linux server to iCloud is open:
[#question-backup-transport](open-questions.md#question-backup-transport).

## Disk encryption

`#disk-encryption`

The server's disk holds a [#local-copy](principles.md#local-copy) of every
private document, so it must be encrypted.

**Today it is not.** No real document is indexed until that is solved. The
question for the founder is
[#question-disk-encryption](open-questions.md#question-disk-encryption).

## Authentication

`#authentication`

The API refuses a call without valid credentials. That holds for the
collectors, and for the duplicate report, which takes changes from the user and
therefore cannot be open.

Who else must authenticate, and how, is open:
[#question-authentication](open-questions.md#question-authentication).

## Sensitive data

`#sensitive-data`

What the server holds and must protect:

- tax ids and identity documents, in the OCR text and in the local copies;
- e-mail text and senders;
- photos with coordinates and persons;
- the providers' access tokens;
- the encrypted backups.

Who it is protected against: another device on the local network, a stolen
server disk or backup, and a leaked token.
