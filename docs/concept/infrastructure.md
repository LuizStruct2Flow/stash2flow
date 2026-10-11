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
- It installs from the repository on any Linux machine with PostgreSQL and
  the tool that isolates reading
  ([isolation of reading](#isolation-of-reading)). The setup lives in `infra/`
  as code, so the machine can be rebuilt from the repository.
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
possibly more than 100,000.

What that costs in time was measured on the
[server](domain-language.md#server), on made-up files only:

| Step | Per hour | 100,000 take |
|---|---|---|
| OCR with Tesseract | about 13,000 pages | about 7.5 hours |
| OCR with a vision model at the [model server](#model-server) | about 550 pages | about 180 hours, which is more than a week |
| Text [embedding](domain-language.md#embedding) | about 84,000 texts | about 1.2 hours |
| Photo [embedding](domain-language.md#embedding) | about 295,000 small images | about 0.3 hours |

So OCR sets the length of the first full [run](domain-language.md#run), and
the choice of the OCR engine changes it from hours to days. Real files are
slower than these: a full-size camera image costs more to decode than the
small images measured, and a long text costs more than a short one. Which OCR
engine is open:
[open question: which models](open-questions.md#question-which-models).

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
[order of sources](domain-language.md#order-of-sources), which
[senders](domain-language.md#sender) are
[trusted](domain-language.md#trusted) and which are
[rejected](domain-language.md#rejected-sender)) and the
[baseline](domain-language.md#baseline). That is why it is backed up.

The rules that make an [asset](domain-language.md#asset)
[whitelisted](domain-language.md#whitelist) by default and the list of
[persons](domain-language.md#person) are not in the database: the
[user](domain-language.md#user) keeps both in the configuration file, which
the [backup](#backup) covers too.

## Model server

`#model-server`

A program on the [user](domain-language.md#user)'s network that serves a local
language model, such as Ollama or the llama.cpp server. The app calls it for
[descriptions](domain-language.md#description), and for OCR only if a vision
model is the OCR engine. The [guardian](domain-language.md#guardian) cannot
reach it, so a [worker](domain-language.md#worker) sends it the picture of a
page that the guardian made. The other models run inside the app's own
process.

Its address is configuration and must be a local one. Details are in
[where models run](architecture.md#where-models-run).

## Token store

`#token-store`

The token store is where the app keeps the
[credentials](domain-language.md#credential) for its
[sources](domain-language.md#source): each source's credential, and the app's
registration with each [provider](domain-language.md#provider). It is a file
on the [server](domain-language.md#server), encrypted.

- A [credential](domain-language.md#credential) is kept there and nowhere
  else: not in the repository and not in the configuration file.
- No command and no log prints a [credential](domain-language.md#credential)
  in full.
- Every permission asked of a [provider](domain-language.md#provider) is
  read-only, at the first sign-in and at each later one.
- A [source](domain-language.md#source)'s
  [credential](domain-language.md#credential) is stored when the
  [user](domain-language.md#user) adds the source or signs in again for it,
  and is deleted when he removes it. The registration is stored when he
  stores or replaces it. What he can do with them, and what the app does by
  itself, is in [credentials](sources.md#credentials).
- The [backup](#backup) covers the token store.
- The [guardian](domain-language.md#guardian) cannot reach it:
  [isolation of reading](#isolation-of-reading).

Where the key that encrypts the token store comes from is open:
[open question: the key of the token store](open-questions.md#question-the-key-of-the-token-store).

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

The [API](domain-language.md#api) refuses a call without valid
[credentials](domain-language.md#credential).
Everything that calls it authenticates: the
[collectors](domain-language.md#collector), the command line, and the browser
that opens the [duplicate report](domain-language.md#duplicate-report).

- Each client has its own token.
- The [API](domain-language.md#api) is served over HTTPS on the local network.
- A [collector](domain-language.md#collector) holds that token and nothing
  else: it holds no [credential](domain-language.md#credential) for a
  [provider](domain-language.md#provider).

How a client gets its token, and how the [user](domain-language.md#user) sees
and withdraws it, is open:
[open question: credentials of the API's clients](open-questions.md#question-credentials-of-the-apis-clients).

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
| cannot reach | the [token store](#token-store), which holds the [credentials](domain-language.md#credential) for the [sources](domain-language.md#source) |
| cannot reach | the [database](#database) or its [credentials](domain-language.md#credential) |
| sees | only the files it is given |
| can start | only the programs it is given |
| never does | run a macro, a script or an executable found inside an [asset](domain-language.md#asset) |

- It holds for every [asset](domain-language.md#asset), also one from a
  [trusted](domain-language.md#trusted) [source](domain-language.md#source) or
  [sender](domain-language.md#sender).
- The same holds on a Mac, because a
  [collector](domain-language.md#collector) works with files there: where the
  inside of an [asset](domain-language.md#asset) is needed, the
  [guardian](domain-language.md#guardian) reads it in the same isolation.

**On the [server](domain-language.md#server) it is made with Bubblewrap
(`bwrap`).** The app starts the process that reads an
[asset](domain-language.md#asset) through it, once per asset:

- **No network.** The process has no way to the internet, to the local
  network or to the [server](domain-language.md#server)'s own services, so it
  reaches neither the [database](#database) nor the
  [model server](#model-server).
- **Only the files it is given**, none of which it can change: the `node`
  program, the system libraries, the app's package and the
  [bytes](domain-language.md#bytes) of the one
  [asset](domain-language.md#asset), taken from the
  [stash](domain-language.md#stash). The [token store](#token-store) and
  every other asset are not among them, so for that process they do not
  exist.
- **Only the programs it is given.** None, unless Tesseract is the OCR engine:
  then Tesseract and its language data are given too, and the
  [guardian](domain-language.md#guardian) starts Tesseract in there.
- **An empty environment.** No address, no token and no password is passed
  in.
- **A vision model stays outside.** When a vision model is the OCR engine,
  the [guardian](domain-language.md#guardian) turns a page into a picture and
  a [worker](domain-language.md#worker), outside the guardian, sends the
  picture to the [model server](#model-server).

What that asks of the [server](domain-language.md#server):

- The tool is installed, and so is Tesseract with its language data when
  Tesseract is the OCR engine. Installing them belongs to the
  [server setup](#server-setup).
- No administrator rights are needed to run it, and nothing is configured on
  the machine: the app passes the whole isolation each time it starts the
  process.
- It adds about 2 milliseconds per [asset](domain-language.md#asset),
  measured with a made-up file.
- A test proves it. The same probe is run twice: plainly, where it reaches
  the network, the database's port, a file standing in for the token store and
  a system program; and in isolation, where it reaches none of the four. Where
  the tool is missing, the test says that the isolation is not proven there:
  [continuous integration](testing.md#continuous-integration).

**On a Mac the mechanism is not measured.** The tool the
[server](domain-language.md#server) uses does not exist there:
[open question: how reading is isolated on a Mac](open-questions.md#question-how-reading-is-isolated-on-a-mac).

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
- the [credentials](domain-language.md#credential) in the
  [token store](#token-store);
- the encrypted backups.

Who it is protected against: another device on the local network, a stolen
[server](domain-language.md#server) disk or backup, a leaked
[credential](domain-language.md#credential), and a
deliberately crafted file among the [assets](domain-language.md#asset)
([isolation of reading](#isolation-of-reading)).
