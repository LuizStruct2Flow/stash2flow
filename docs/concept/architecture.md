# Architecture

How the code of stash2flow is organized: its layers, what belongs in each, how
the server and the Mac collector share code, and where the models run. Read
this before writing or reviewing code. It describes structure, not behaviour;
behaviour is in [how-it-works.md](how-it-works.md).

## Hexagonal layering

`#hexagonal-layering`

The code has four layers, and dependencies point inward only:

```
adapters  →  ports  →  application (use-cases)  →  domain
```

- **Domain**: the rules. No input or output; it imports nothing but itself.
- **Application**: the use-cases. Depends on the domain and the ports.
- **Ports**: what the use-cases need from the outside world, as interfaces.
- **Adapters**: the real things behind the ports, such as a provider's API or
  the database, and the things that drive the app, such as the API and the
  command line.

This is the layering the project's
[stack defaults](../../STACK_DEFAULTS.md) prescribe.

## What goes where

`#what-goes-where`

| Layer | Contents |
|---|---|
| Domain | The file and its identity; the source; the run; the duplicate group. The rules: what counts as unchanged, exact and near matching, the keeper suggestion, kind and has_text, the choice of file_date, the normal form of names, the doc_type vocabulary, which e-mails are indexed (whitelist and blacklist), and which pipeline steps a file still needs. |
| Application | Run a source (full, incremental, resumable; marks vanished files) · accept file records · process a file through the pipeline · process existing files for a step on request · group duplicates and suggest keepers · change a keeper, mark a group reviewed · sort senders · search · find photos · build the duplicate report · summarise a run. |
| Ports | See [#ports-and-adapters](#ports-and-adapters). |
| Adapters | See [#ports-and-adapters](#ports-and-adapters). |

## Ports and adapters

`#ports-and-adapters`

No port is added before a slice of the
[plan](../doing/PLAN-FEATURE-001-media-index.md#slices) needs it.

| Port | What it does | Adapters | First needed in slice |
|---|---|---|---|
| Reading a source (no agreed word yet) | lists a source, reports changes since a cursor, hands over bytes | Google Drive, OneDrive, Gmail, iCloud Drive (a folder), iCloud Photos (`osxphotos`); a fake | 2 |
| What a run talks to (no agreed word yet) | narrow: all that running a source needs, see [#one-use-case-two-programs](#one-use-case-two-programs) | onto the index (server); an API client (collector); a fake | 2; cursor and checkpoint in 3 |
| Index | wide, server only: files, OCR text, embeddings, duplicate groups, runs, pipeline progress, senders | PostgreSQL; an in-memory fake | 2 |
| OCR | page image to text | the engine chosen in slice 1; a fake that replays fixtures | 2 |
| File reading | metadata, phash, PDF text layer and page rendering, thumbnail | image and PDF libraries | 2 |
| Store of local copies (no agreed word yet) | keeps each file's bytes, addressed by sha256 | a directory on the server | 2 |
| Token store | keeps the providers' access tokens | an encrypted file on the server | 2 |
| Clock | the time | the system | 2 |
| Description | OCR text to description, doc_type, doc_date, person, issuer | the local model server; a fake | 6 |
| Text embedding | OCR text and query text to a vector | a model inside the app's process; a fake | 7 |
| Image embedding | a photo to a vector, **and query text to a vector in the same model**; the text-embedding port is no substitute | a model inside the app's process; a fake | 10 |
| Notification | sends the summary notification | depends on the channel chosen | 11 |

The driving side: the API (taking file records, search, the duplicate report
with its two changes), the command line `stash`, and the scheduler's entry
point.

The words still missing are listed in
[domain-language.md](domain-language.md#words-still-to-name).

## One use-case, two programs

`#one-use-case-two-programs`

The server and the collector are one package with two entry points. Both wire
the **same** "run a source" use-case and the **same** hashing code, with
different adapters:

| | Server | Collector |
|---|---|---|
| Sources read | OneDrive, Google Drive, Gmail | iCloud Photos, iCloud Drive |
| What the run talks to | straight onto the index | an API client, to the server's API |
| OCR, embeddings, description | yes | no |

What a run talks to has five operations and nothing else:

1. take a batch of file records together with the position reached;
2. give a source's stored cursor and checkpoint;
3. answer, per file record, whether the file is unchanged;
4. mark vanished files;
5. record a run's start, finish and errors.

| Question | Answer |
|---|---|
| Where does a collector's cursor live? | On the server, with the source, like every other. The collector keeps no state. |
| Who decides "unchanged"? | One domain rule, applied on the server when the file record arrives. The puller or collector never decides. The rule is [#unchanged-files](how-it-works.md#unchanged-files). |
| When may a cursor or checkpoint advance? | After the server has stored the batch and its position together and acknowledged. |
| A batch delivered twice? | Changes nothing. |
| How do a collector's bytes reach the server? | The collector uploads them to the API for every new or changed file. The server never calls a Mac. |

The phash is computed by one implementation on both sides. That is what lets
the same photo, read on a Mac and read on the server, land in one near group.

## Dependency rule

`#dependency-rule`

The inward-only rule is enforced by a lint that runs in the gate (the checks
that run before every push), built on `eslint-plugin-boundaries` and restricted
imports:

| Rule | Why |
|---|---|
| Domain imports only domain: no Node built-ins, no packages | Otherwise "no input or output" is unenforced. |
| Application imports domain and ports; ports import domain | Inward only. |
| Adapters are imported only by the two entry points | |
| Step definitions of the specifications import application, ports and fakes; real adapters only in the marked integration subset | Test code is under the same rule. |
| Code that starts an external program is allowed in one place only: the iCloud Photos adapter | `osxphotos` is a command-line program, so an import rule cannot hold it. |
| The name of the photo library's package appears in no string of the app's code | The photo library is never read directly. |

**Proven to bite:** the lint lands together with one rejected example per row.

**What the lint cannot see:** a path built while the program runs. The iCloud
Photos adapter's contract test, on recorded `osxphotos` output, is the second
check.

## Where models run

`#where-models-run`

| Model for | Runs | Configured by |
|---|---|---|
| OCR | Inside the app's process (Tesseract, or a model through ONNX Runtime for Node). If the benchmark picks a local vision model instead: at the local model server. | model name |
| Text embedding | Inside the app's process (`@huggingface/transformers`) | model name |
| Image embedding, for photos and query text | Inside the app's process (`@huggingface/transformers`) | model name |
| Description | At a local model server, over the OpenAI-compatible chat-completions HTTP API, which Ollama and the llama.cpp server speak. It needs text in and text out, and image in only if OCR goes this way. | address and model name |

The model server's address must be loopback or in a private range, including
the range VPNs use. Any other address is refused at start. There is no key and
no switch for a model outside the network:
[#local-models-only](principles.md#local-models-only).

Models are never called in the gate. See
[#pinned-stages](testing.md#pinned-stages).

## Directory layout

`#directory-layout`

```
backend/
  package.json     ← the four scripts the gate calls: build, lint, format:check, test:coverage
  src/
    domain/
    application/
    ports/
    adapters/{sources,index,ocr,description,embeddings,api,cli,...}/
    server.ts      ← entry point: wires the server's adapters
    collector.ts   ← entry point: wires the Mac's adapters
  features/        ← *.feature, steps/ (step definitions), support/ (runner, pending check)
  spikes/          ← slice 1 benchmarks; not shipped, not counted for coverage
infra/             ← server setup as code, backup script
```

- Unit tests sit next to their source as `*.spec.ts`.
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
| AWS Lambda, serverless | A self-hosted server | No document text or image may leave the user's network, and the local models need that machine. |
| DynamoDB | PostgreSQL with pgvector, unaccent and pg_trgm | Full-text, fuzzy, vector and hash matching in one system. |
| Hosted model APIs | Local models only | Privacy; no billable path. |
| React or Next with Amplify | In the index item, one server-rendered page: the duplicate report. | One page does not warrant a frontend. The frontend is its own item, [FEATURE-003](../doing/BACKLOG.md). |
| AWS CDK | Server setup scripted in `infra/` | No cloud resources exist. |
| CloudWatch observability | The "local app" recipe: logs on the server, runs that can be queried, a notification | Nothing runs in AWS. |
| CodeCommit | A public GitHub repository | The founder's choice. |

## Language choice

`#language-choice`

Everything is TypeScript. The server and the collector are one TypeScript
package, so the gate works as shipped and the phash has one implementation.

Two programs stay outside the package, installed separately and called by
adapters: `osxphotos` (command-line, on the Mac) and the local model server.

## Libraries to prove

`#libraries-to-prove`

Candidates, to be proven in slice 1 before anything is built on them:

| Need | Candidate | Known risk |
|---|---|---|
| PDF text layer, page rendering | `mupdf` or `pdfjs-dist` | none known |
| Photo metadata | `exifr` | none known |
| phash | `sharp` plus one small hash function | HEIC is not in `sharp`'s prebuilt binaries; it needs a separate decoder, on Linux and on the Mac |
| OCR | as in [#where-models-run](#where-models-run); chosen by the benchmark | quality on poor Portuguese and German scans |
| Embeddings | as in [#where-models-run](#where-models-run) | files per hour on the first full run, not measured |
| iCloud Photos | `osxphotos` as a command-line program | must be installed on the Mac |

Slice 1 has to prove the two doubts about TypeScript wrong: an OCR engine good
enough on real scans, and HEIC decoding on both machines.
