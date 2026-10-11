# Architecture

How the code of stash2flow is organized: its layers, what belongs in each, how
the [server](domain-language.md#server) and the Mac
[collector](domain-language.md#collector) share code, and where the models run.
Read this before writing or reviewing code. It describes structure, not
behaviour; behaviour is in [how-it-works.md](how-it-works.md).

## Hexagonal layering

`#hexagonal-layering`

The code has four layers, and dependencies point inward only:

```
adapters  →  ports  →  application (use-cases)  →  domain
```

- **Domain**: the rules. No input or output; it imports nothing but itself.
- **Application**: the use-cases. Depends on the domain and the ports.
- **Ports**: what the use-cases need from the outside world, as interfaces.
- **Adapters**: the real things behind the ports, such as a
  [provider](domain-language.md#provider)'s API or the database, and the things
  that drive the app, such as the [API](domain-language.md#api) and the command
  line.

This is the layering the project's
[stack defaults](../../STACK_DEFAULTS.md) prescribe.

## What goes where

`#what-goes-where`

| Layer | Contents |
|---|---|
| Domain | The [asset](domain-language.md#asset) and its identity; the [source](domain-language.md#source); the [run](domain-language.md#run); the [duplicate group](domain-language.md#duplicate-group). The rules: what counts as unchanged, [exact](domain-language.md#exact) and [near](domain-language.md#near) matching, the [keeper](domain-language.md#keeper) suggestion, [kind](domain-language.md#kind) and [has_text](domain-language.md#has_text), the choice of [asset_date](domain-language.md#asset_date), the normal form of names, the [doc_type](domain-language.md#doc_type) vocabulary, whether an asset is [whitelisted](domain-language.md#whitelist), [blacklisted](domain-language.md#blacklist) or neither, which [e-mail](domain-language.md#e-mail) is an [advertisement](domain-language.md#advertisement) by its [mail_label](domain-language.md#mail_label) and which is [spam](domain-language.md#spam) by its mail_label or its [rejected sender](domain-language.md#rejected-sender), when an advertisement's week of validity has passed, whether a source or a [sender](domain-language.md#sender) is [trusted](domain-language.md#trusted), that the mail_label is applied before trust, and which [pipeline](domain-language.md#pipeline) steps an asset still needs, from its [completed steps](domain-language.md#completed-steps). |
| Application | Run a [source](domain-language.md#source) (full, incremental, resumable; marks [vanished](domain-language.md#vanished) assets) · accept [asset records](domain-language.md#asset-record) · process an [asset](domain-language.md#asset) through the [pipeline](domain-language.md#pipeline) · process existing assets for a step on request · group [duplicates](domain-language.md#duplicate) and suggest [keepers](domain-language.md#keeper) · change a keeper, mark a group [reviewed](domain-language.md#reviewed) · tell an [advertisement](domain-language.md#advertisement) and [spam](domain-language.md#spam) from the other [e-mails](domain-language.md#e-mail) · list the [undecided senders](domain-language.md#undecided-sender), and take the [user](domain-language.md#user)'s decision whether one is [trusted](domain-language.md#trusted) or [rejected](domain-language.md#rejected-sender) · read the [e-mails](domain-language.md#e-mail) recorded while their [sender](domain-language.md#sender) was undecided, once it is trusted · search · find photos · build the [duplicate report](domain-language.md#duplicate-report) · summarise a [run](domain-language.md#run). |
| Ports | See [ports and adapters](#ports-and-adapters). |
| Adapters | See [ports and adapters](#ports-and-adapters). |

## Ports and adapters

`#ports-and-adapters`

No port is added before a slice of the
[plan](../doing/PLAN-FEATURE-001-media-index.md#slices) needs it.

| Port | What it does | Adapters | First needed in slice |
|---|---|---|---|
| [Fetching](domain-language.md#fetching) | lists a [source](domain-language.md#source), reports changes since a [cursor](domain-language.md#cursor), brings the [bytes](domain-language.md#bytes) | Google Drive, OneDrive, a folder on a network storage device, Gmail, iCloud Drive (a folder), iCloud Photos (`osxphotos`); a fake | 2 |
| [Ledger](domain-language.md#ledger) | narrow: all that a [run](domain-language.md#run) needs, see [one use-case, two programs](#one-use-case-two-programs) | onto the index ([server](domain-language.md#server)); an [API](domain-language.md#api) client ([collector](domain-language.md#collector)); a fake | 2; [cursor](domain-language.md#cursor) and [checkpoint](domain-language.md#checkpoint) in 3 |
| Index | wide, [server](domain-language.md#server) only: [assets](domain-language.md#asset), [OCR text](domain-language.md#ocr-text), [embeddings](domain-language.md#embedding), [duplicate groups](domain-language.md#duplicate-group), [runs](domain-language.md#run), [completed steps](domain-language.md#completed-steps), whether an asset is [whitelisted](domain-language.md#whitelist) or [blacklisted](domain-language.md#blacklist) | PostgreSQL; an in-memory fake | 2 |
| OCR | page image to text | Tesseract, started by the [guardian](domain-language.md#guardian) inside its isolation, or a vision model at the local model server; which of the two is open: [open question: which models](open-questions.md#question-which-models); a fake that replays fixtures | 2 |
| File reading | metadata, [phash](domain-language.md#phash), PDF [text layer](domain-language.md#text-layer) and page rendering, thumbnail; the text of an office document; for an [e-mail](domain-language.md#e-mail), its text and its [attachments](domain-language.md#attachment). Its adapters are the [guardian](domain-language.md#guardian)'s and run in isolation: [reading in isolation](#reading-in-isolation) | image, PDF and office document libraries; an e-mail parsing library in slice 5 | 2 |
| [Stash](domain-language.md#stash) | keeps each [asset](domain-language.md#asset)'s [local copy](domain-language.md#local-copy), addressed by [sha256](domain-language.md#md5-and-sha256) | a directory on the [server](domain-language.md#server) | 2 |
| Token store | keeps the [providers](domain-language.md#provider)' access tokens | an encrypted file on the [server](domain-language.md#server) | 2 |
| Clock | the time | the system | 2 |
| Description | [OCR text](domain-language.md#ocr-text) to [description](domain-language.md#description), [doc_type](domain-language.md#doc_type), [doc_date](domain-language.md#doc_date), [persons](domain-language.md#person), [issuer](domain-language.md#issuer) | the local model server; a fake | 6 |
| Text embedding | [OCR text](domain-language.md#ocr-text) and query text to a vector | a model inside the app's process; a fake | 7 |
| Image embedding | a photo to a vector, **and query text to a vector in the same model**; the text-embedding port is no substitute | a model inside the app's process; a fake | 10 |
| Notification | sends the [summary notification](domain-language.md#summary-notification) | depends on the channel chosen | 11 |

The driving side: the [API](domain-language.md#api) (taking
[asset records](domain-language.md#asset-record), search, the
[duplicate report](domain-language.md#duplicate-report) with its two changes),
the command line `stash`, and the [scheduler](domain-language.md#scheduler)'s
entry point.

## One use-case, two programs

`#one-use-case-two-programs`

The [server](domain-language.md#server) and the
[collector](domain-language.md#collector) are one package with two entry
points. Both wire the **same** "[run](domain-language.md#run) a
[source](domain-language.md#source)" use-case and the **same** hashing code,
with different adapters:

| | Server | Collector |
|---|---|---|
| [Sources](domain-language.md#source) [fetched](domain-language.md#fetching) | OneDrive, Google Drive, a folder on a network storage device, Gmail | iCloud Photos, iCloud Drive |
| [Ledger](domain-language.md#ledger) | straight onto the index | an [API](domain-language.md#api) client, to the [server](domain-language.md#server)'s API |
| [Guardian](domain-language.md#guardian) | yes | yes, in the same isolation: [reading in isolation](#reading-in-isolation) |
| OCR, [embeddings](domain-language.md#embedding), [description](domain-language.md#description) | yes | no |

The [ledger](domain-language.md#ledger) has five operations and nothing else:

1. take a batch of [asset records](domain-language.md#asset-record) together with
   the position reached;
2. give a [source](domain-language.md#source)'s stored
   [cursor](domain-language.md#cursor) and
   [checkpoint](domain-language.md#checkpoint);
3. answer, per [asset record](domain-language.md#asset-record), whether the
   [asset](domain-language.md#asset) is unchanged;
4. mark [vanished](domain-language.md#vanished) [assets](domain-language.md#asset);
5. record a [run](domain-language.md#run)'s start, finish and errors.

| Question | Answer |
|---|---|
| Where does a [collector](domain-language.md#collector)'s [cursor](domain-language.md#cursor) live? | On the [server](domain-language.md#server), with the [source](domain-language.md#source), like every other. The collector keeps no state. |
| What when a second [collector](domain-language.md#collector) sends [asset records](domain-language.md#asset-record) for the same [source](domain-language.md#source)? | They update the same rows, because a source is unique by its [location](domain-language.md#location) and its [account](domain-language.md#account). [collected_by](domain-language.md#collected_by) records which machine sent them. |
| Who decides "unchanged"? | One domain rule, applied on the [server](domain-language.md#server) when the [asset record](domain-language.md#asset-record) arrives. The [puller](domain-language.md#puller) or [collector](domain-language.md#collector) never decides. The rule is [unchanged assets](how-it-works.md#unchanged-assets). |
| When may a [cursor](domain-language.md#cursor) or [checkpoint](domain-language.md#checkpoint) advance? | After the [server](domain-language.md#server) has stored the batch and its position together and acknowledged. |
| A batch delivered twice? | Changes nothing. |
| How do a [collector](domain-language.md#collector)'s [bytes](domain-language.md#bytes) reach the [server](domain-language.md#server)? | The collector uploads them to the [API](domain-language.md#api) for every new or changed [asset](domain-language.md#asset). The server never calls a Mac. |

The [phash](domain-language.md#phash) is computed by one implementation on both
sides. That is what lets the same photo, hashed on a Mac and hashed on the
[server](domain-language.md#server), land in one [near](domain-language.md#near)
group.

## Reading in isolation

`#reading-in-isolation`

Taking text and pictures out of an [asset](domain-language.md#asset) is done
in one part of the app, the [guardian](domain-language.md#guardian), kept apart
from everything else. It decides whether an asset may be read, by whether its
[source](domain-language.md#source) or [sender](domain-language.md#sender) is
[trusted](domain-language.md#trusted), and reads it in isolation. A
deliberately crafted file that breaks a reading library then reaches nothing.

| The [guardian](domain-language.md#guardian)'s reading | |
|---|---|
| What runs there | every adapter that opens an [asset](domain-language.md#asset)'s [bytes](domain-language.md#bytes) with a library: the file-reading adapters (images, PDFs, office documents, [e-mails](domain-language.md#e-mail)); and Tesseract, when it is the OCR engine, as a program the [guardian](domain-language.md#guardian) starts |
| What goes in | the [bytes](domain-language.md#bytes) of one [asset](domain-language.md#asset) |
| What comes out | text, pictures and metadata, as data |
| What it cannot reach | the network; the token store; the index and the database behind it; any file and any program it was not given |
| What it never does | run a macro, a script or an executable found inside an [asset](domain-language.md#asset) |

- **It holds for every [asset](domain-language.md#asset)**, also one from a
  [trusted](domain-language.md#trusted) [source](domain-language.md#source) or
  [sender](domain-language.md#sender). Trust decides what is read; isolation
  limits what a broken reading can do.
- **Nothing outside the [guardian](domain-language.md#guardian) touches the
  inside of an [asset](domain-language.md#asset)**: nothing else opens its
  [bytes](domain-language.md#bytes) with a library. Hashing the bytes and
  keeping them in the [stash](domain-language.md#stash) do not open them, so
  they stay outside.
- **A model at the model server gets only what came out**: text, or a picture
  of a page. It never gets the [asset](domain-language.md#asset)'s
  [bytes](domain-language.md#bytes). The
  [guardian](domain-language.md#guardian) has no network, so it cannot reach
  the model server: when a vision model is the OCR engine, the guardian turns
  a page into a picture, and a [worker](domain-language.md#worker), outside
  the guardian, sends the picture to the model server.
- **Tesseract, when it is the OCR engine, is started inside the isolation.**
  It is a program the [guardian](domain-language.md#guardian) is given, and it
  reaches no more than the guardian does.
- **No remote image and no link of an [e-mail](domain-language.md#e-mail) is
  loaded.** The [guardian](domain-language.md#guardian) has no network to load
  it with.
- **On a Mac too.** A [collector](domain-language.md#collector) works with
  files there. Where it needs the inside of an
  [asset](domain-language.md#asset), for the
  [phash](domain-language.md#phash), the
  [guardian](domain-language.md#guardian) reads it, in the same isolation.

**On the [server](domain-language.md#server) the isolation is made with
Bubblewrap (`bwrap`).** Each [asset](domain-language.md#asset) is read in a
process of its own:

| The process that reads an [asset](domain-language.md#asset) | |
|---|---|
| has no network | not the internet, not the local network, and not the [server](domain-language.md#server)'s own services, such as the database |
| sees only the files it is given, and cannot change them | the `node` program, the system libraries, the app's package, the [bytes](domain-language.md#bytes) of the one [asset](domain-language.md#asset) from the [stash](domain-language.md#stash) and, when Tesseract is the OCR engine, Tesseract with its language data |
| can start only the programs it is given | a program it was not given does not exist in there |
| gets an empty environment | no address, no token and no password is in it |
| hands back data | text, pictures and metadata, written to its output |

The reading libraries run in there unchanged. Starting the process adds about
2 milliseconds per [asset](domain-language.md#asset), measured with a made-up
file, and it needs no administrator rights.

**On a Mac the mechanism is not measured.** The tool the
[server](domain-language.md#server) uses does not exist there:
[open question: how reading is isolated on a Mac](open-questions.md#question-how-reading-is-isolated-on-a-mac).

What the isolation requires of the installation is in
[isolation of reading](infrastructure.md#isolation-of-reading). The rule it
serves is
[the app reads what it trusts, in isolation, and runs nothing](principles.md#the-app-reads-what-it-trusts-in-isolation-and-runs-nothing).

## Dependency rule

`#dependency-rule`

The inward-only rule is enforced by a lint that runs in the gate (the checks
that run before every push) and in
[continuous integration](testing.md#continuous-integration). It is built on
ESLint's own rules for restricted imports and restricted syntax, with no
plugin, and its rules are in `backend/eslint.layers.mjs`:

| Rule | Why |
|---|---|
| Domain imports only domain: no Node built-ins, no packages. Only its unit tests may import the test runner | Otherwise "no input or output" is unenforced. |
| Application imports domain and ports; ports import domain | Inward only. |
| Adapters are imported only by the two entry points and by other adapters | |
| A fake is imported only by a unit test and by a step definition | A fake never reaches the running app. |
| Step definitions of the specifications import application, ports and fakes; real adapters only in an integration step file, named `*.integration.steps.ts` | Test code is under the same rule. |
| Code that starts an external program is allowed in two places only: the iCloud Photos adapter and the [guardian](domain-language.md#guardian) | `osxphotos` is a command-line program. Tesseract, when it is the OCR engine, is one too, and the guardian starts it inside its isolation: [reading in isolation](#reading-in-isolation). |
| The name of the photo library's package appears in no string of the app's code | The photo library is never opened directly. |

**Proven to bite:** `backend/lint-fixtures/` holds one rejected example per
row, with accepted examples beside them. A test in the gate fails when a
rejected example is accepted or an accepted one is rejected.

**What the lint cannot see:**

- A path built while the program runs. The iCloud Photos adapter's contract
  test, on recorded `osxphotos` output, is the second check.
- Which program the [guardian](domain-language.md#guardian) starts. The
  isolation holds that: a program the guardian was not given does not exist
  where it runs.

## Where models run

`#where-models-run`

| Model for | Runs | Configured by |
|---|---|---|
| OCR | Tesseract: a program the [guardian](domain-language.md#guardian) starts inside its isolation. A vision model: at the local model server, which gets the picture of a page from a [worker](domain-language.md#worker). Which of the two is open: [open question: which models](open-questions.md#question-which-models). | which engine; for a vision model, the model name |
| Text embedding | Inside the app's process. It is measured only at the local model server: [open question: which models](open-questions.md#question-which-models). | model name |
| Image embedding, for photos and query text | Inside the app's process (`@huggingface/transformers`) | model name |
| Description | At a local model server, over the OpenAI-compatible chat-completions HTTP API, which Ollama and the llama.cpp server speak. It needs text in and text out, and image in only if OCR goes this way. | address and model name |

The model server's address must be loopback or in a private range, including
the range VPNs use. Any other address is refused at start. There is no key and
no switch for a model outside the network:
[local models only](principles.md#local-models-only).

Models are never called in the gate. See
[pinned stages](testing.md#pinned-stages).

## Directory layout

`#directory-layout`

```
backend/
  package.json     ← the four scripts the gate calls: build, lint, format:check, test:coverage
  eslint.layers.mjs ← the rules of the dependency rule
  src/
    domain/
    application/
    ports/
    fakes/         ← the fakes of the ports, for tests only
    adapters/{sources,guardian,index,ocr,description,embeddings,api,cli,...}/
    adapters/sources/icloud-photos/  ← the iCloud Photos adapter; may start a program
    adapters/guardian/               ← the guardian's adapters; may start a program
    server.ts      ← entry point: wires the server's adapters
    collector.ts   ← entry point: wires the Mac's adapters
  features/        ← *.feature, steps/ (step definitions), support/ (runner, pending check, the proofs of the dependency rule and of the isolation)
  lint-fixtures/   ← accepted and rejected examples for the dependency rule
  spikes/          ← slice 1 measurements; not shipped, not counted for coverage
infra/             ← server setup as code, backup script
```

- Unit tests sit next to their source as `*.spec.ts`.
- A step file that needs a real adapter is named `*.integration.steps.ts`.
  Every other step file, `*.steps.ts`, gets fakes only.
- `features/` is inside `backend/` because the gate runs only `npm run …`
  there: `test:coverage` runs the unit tests and then the specifications.
- The gate's check that every bug has a regression test looks in `backend/src`.
  It counts only `*.spec.*` files, never a `.feature` file.

## Deviations from the stack defaults

`#deviations-from-the-stack-defaults`

The project's [stack defaults](../../STACK_DEFAULTS.md) assume a cloud product.
This app differs, each time for a stated reason:

| Default | This project | Why |
|---|---|---|
| AWS Lambda, serverless | A self-hosted [server](domain-language.md#server) | No document text or image may leave the user's network, and the local models need that machine. |
| DynamoDB | PostgreSQL with pgvector, unaccent and pg_trgm | Full-text, fuzzy, vector and hash matching in one system. |
| Hosted model APIs | Local models only | Privacy; no billable path. |
| React or Next with Amplify | In the index item, one server-rendered page: the [duplicate report](domain-language.md#duplicate-report). | One page does not warrant a frontend. The frontend is its own item, [FEATURE-003](../doing/BACKLOG.md). |
| AWS CDK | Server setup scripted in `infra/` | No cloud resources exist. |
| CloudWatch observability | The "local app" recipe: logs on the [server](domain-language.md#server), [runs](domain-language.md#run) that can be queried, a notification | Nothing runs in AWS. |
| CodeCommit | A public GitHub repository | The app is open source. |

## Language choice

`#language-choice`

Everything is TypeScript. The [server](domain-language.md#server) and the
[collector](domain-language.md#collector) are one TypeScript package, so the
gate works as shipped and the [phash](domain-language.md#phash) has one
implementation.

These programs stay outside the package, installed separately and called by
adapters: `osxphotos` (command-line, on the Mac); the local model server; the
tool that makes the isolation on the [server](domain-language.md#server); and
Tesseract with its language data, when it is the OCR engine.

## Reading libraries

`#reading-libraries`

What carries the reading work. The measurements were made on the
[server](domain-language.md#server), on made-up files only; nothing is
measured on a Mac.

**Measured, and working:**

| Need | What carries it | What the measurement showed | Not measured |
|---|---|---|---|
| Decoding a HEIC image | `heic-decode`, which brings its own decoder | It decodes a made-up HEIC image, also inside the isolation. `sharp`'s prebuilt binaries cannot decode HEIC. | speed on a full-size camera image; a Mac |
| [phash](domain-language.md#phash) | one hash function in TypeScript, 64 bits, on pixels decoded by `sharp`, or by `heic-decode` for HEIC | A picture, its resized copy, its recompressed JPG copy and its HEIC copy gave the same value: distance 0. A different picture was 38 bits away. | where the [near](domain-language.md#near) threshold belongs: [open question: near threshold](open-questions.md#question-near-threshold) |
| OCR | Tesseract 5 as a program, or a vision model at the local model server | Both gave the text of made-up pages in Portuguese, German and English with at least 99.7 % of the characters right. Tesseract did about 13,000 pages an hour, the vision model about 550. | which is better on real [scans](domain-language.md#scan): [open question: which models](open-questions.md#question-which-models) |
| Text [embedding](domain-language.md#embedding) | `bge-m3`, at the local model server | About 84,000 texts an hour. English query words ranked a Portuguese document first, ahead of an English one about something else. | the same model inside the app's process |
| Photo [embedding](domain-language.md#embedding) | CLIP ViT-B/32 through `@huggingface/transformers`, inside the app's process | About 295,000 small images an hour. | a full-size camera image, which costs more to decode |

What these numbers mean for the first full [run](domain-language.md#run) is in
[expected volume](infrastructure.md#expected-volume).

The model files of the photo [embedding](domain-language.md#embedding) have to
be on the [server](domain-language.md#server) before the model is used. They
are downloaded once; after that the model works with no network.

**Candidates, not measured.** Each has to be proven before anything is built
on it:

| Need | Candidate | Known risk |
|---|---|---|
| PDF [text layer](domain-language.md#text-layer), page rendering | `mupdf` or `pdfjs-dist` | none known |
| Text of an office document | none named yet | the library must take the text out without running a macro |
| Photo metadata | `exifr` | none known |
| iCloud Photos | `osxphotos` as a command-line program | must be installed on the Mac |
