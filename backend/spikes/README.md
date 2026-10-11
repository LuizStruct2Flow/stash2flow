# Slice 1 spikes: can TypeScript carry the reading work?

Evidence, measured on made-up files only (invented names, invented issuers, invalid identification numbers). Nothing here is production code; nothing here is imported by `backend/src`.

Run order: `node spikes/fixtures.ts`, then `heic-phash.ts`, `ocr.ts`, `embeddings.ts` (from `backend/`). Everything generated or downloaded goes to `~/.cache/stash2flow-spikes/` (outside the repository). Machine: 32 CPU cores, no GPU tools found, Node 22, Ollama on `127.0.0.1:11434`.

## 1. HEIC decoding

| Library                                                     | Result                                                                                                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `heic-decode` (libheif-js, WASM, includes the HEVC decoder) | Works. 1200x800 photo decoded in 0.03 s.                                                                                                                                     |
| `sharp` 0.35 (prebuilt libvips)                             | Fails: `heif: Support for this compression format has not been built in: HEVC`. Confirmed.                                                                                   |
| System libheif 1.21 (used by ImageMagick)                   | Reads no HEIC: only the AV1 plugin is installed, no libde265.                                                                                                                |
| (writing HEIC)                                              | No JavaScript package encodes HEIC. The fixture is encoded by `make-heic.py` using the `pillow-heif` wheel (bundles x265), unpacked into the cache. Fixture generation only. |

## 2. The same phash for the same picture

64-bit DCT [phash](../../docs/concept/domain-language.md#phash) in TypeScript (`heic-phash.ts`): 32x32 grey (sharp, lanczos3), 2-D DCT, 8x8 low block against its median. The HEIC copy is decoded by `heic-decode`, the others by `sharp`.

| Pair                                   | Hamming distance |
| -------------------------------------- | ---------------- |
| original vs resized copy (400 px wide) | 0                |
| original vs JPEG copy (quality 30)     | 0                |
| original vs HEIC copy                  | 0                |
| original vs a different image          | 38               |
| HEIC copy vs a different image         | 38               |

In this sample, any threshold from 1 to 37 separates copies from different pictures; a [near](../../docs/concept/domain-language.md#near) threshold of 10 sits well inside the gap. The sample is two flat-colour scenes and one pair, so this shows the pipeline is deterministic across decoders, not where the threshold belongs for real photos.

## 3. OCR from TypeScript

Six made-up pages (two each in Portuguese, German, English; accented letters, 1.2 degree rotation, Gaussian noise; clean serif font at 150 dpi). Character accuracy against the rendered text. Pages per hour is over all six pages, one at a time.

| Candidate                                        | Portuguese | German | English | Pages/hour |
| ------------------------------------------------ | ---------- | ------ | ------- | ---------- |
| Tesseract 5 (`tessdata_fast`, `execFile`)        | 99.7 %     | 100 %  | 100 %   | 13,477     |
| `qwen2.5vl:7b` via Ollama (page at 1024 px wide) | 100 %      | 100 %  | 100 %   | 550        |

Both read the [OCR text](../../docs/concept/domain-language.md#ocr-text) of these easy pages correctly; the separation between them needs real scans, which this task does not use.

## 4. Embeddings speed

| Model                                                                                       | How it runs                                                     | Items/hour | 100,000 items |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------- | ------------- |
| `bge-m3` text [embedding](../../docs/concept/domain-language.md#embedding), 1024 dimensions | Ollama, batches of 8, 48 texts of about 60 words                | 83,989     | 1.2 h         |
| CLIP ViT-B/32 photo embedding                                                               | `@huggingface/transformers`, fp32, CPU, batches of 8, 32 images | 295,151    | 0.3 h         |

The photo figure uses 1200x800 images; decoding a 12-megapixel camera file costs more than this, so it is a ceiling. Text length drives the text figure.

## 5. A query in one language finding text in another

English query "rental agreement for an apartment, monthly rent" against four made-up documents, cosine similarity from `bge-m3`:

| Score | Document                   |
| ----- | -------------------------- |
| 0.694 | Portuguese rental contract |
| 0.467 | English clinic appointment |
| 0.388 | German electricity bill    |
| 0.305 | Portuguese cake recipe     |

## 6. Isolating the guardian

With what can the [guardian](../../docs/concept/domain-language.md#guardian) be isolated on the [server](../../docs/concept/domain-language.md#server), without administrator rights? `isolation.ts` runs one probe (`features/support/isolation-probe.ts`) under each candidate. The probe tries to reach a throwaway listener through the machine's own address (the network) and through loopback (the database port), to read a file standing in for the token store, and to start a system program. Plainly it reaches all four; the proof `features/support/isolation.spec.ts` runs the same probe plainly and under the chosen mechanism, and runs in the gate. Start-up is the median of five runs of the probe, against 50 ms for plain `node`.

| Mechanism                      | Available here | Needs administrator rights                                                                    | Blocks network                                                                  | Blocks files                                                                                   | Blocks starting programs                                                                                 | Start-up per asset |
| ------------------------------ | -------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------ |
| `node --permission` (built in) | yes            | no                                                                                            | **no**: the permission model does not cover the network at all                  | yes, outside the allowed paths; a native library such as `sharp` runs outside the model though | yes, in Node only (`child_process`); native code is not held                                             | +0 ms              |
| `unshare --user --net`         | yes            | no, but only unmapped: mapping a user id is refused here, so no mount namespace, no file view | yes (`ENETUNREACH`)                                                             | **no**: every file of the user stays readable                                                  | **no**                                                                                                   | +0 ms              |
| `bwrap` (bubblewrap 0.11)      | yes            | no                                                                                            | yes: own empty loopback (`ECONNREFUSED`), nothing else routable (`ENETUNREACH`) | yes: only what is mounted exists (`ENOENT`)                                                    | a program that is not mounted does not exist (`ENOENT`); `exec` itself is not forbidden, that is seccomp | +2 ms              |
| `docker run --network none`    | yes            | membership in the docker group, which is root-equivalent                                      | yes (`ENETUNREACH`, `ECONNREFUSED`)                                             | yes: only what is mounted exists                                                               | **no**: the image's own programs are there                                                               | +260 ms            |

The docker row was measured with the host's `node` binary mounted into a Debian image already on the machine, because no node image was present and nothing was pulled. Inside the bwrap sandbox `sharp` (native), `heic-decode` (WASM) and Tesseract 5 all run unchanged; Tesseract read a made-up page correctly with its binary and language data mounted read-only.

Recommended for the [server](../../docs/concept/domain-language.md#server): bwrap, because it is the only mechanism here that cuts the network, the files and the system programs at once without administrator rights, costs about 2 ms per [asset](../../docs/concept/domain-language.md#asset), and the reading libraries run inside it unchanged. The isolated [guardian](../../docs/concept/domain-language.md#guardian) is given, read-only, the `node` binary, the system libraries, the app package, the one asset's bytes from the [stash](../../docs/concept/domain-language.md#stash) at a fixed path and, for OCR, the Tesseract binary with its language data; it gets an empty environment, so no address, token or password is in there, and its text, pictures and metadata come back as data on its standard output, a pipe. OCR by Tesseract fits inside the sandbox, proven above; OCR by a vision model cannot, since there is no network in there, so the guardian renders a page to pixels and the [worker](../../docs/concept/domain-language.md#worker) outside sends the pixels to the model server, which is the rule that a model gets only what came out. Two things stay open on the server: Tesseract is a program the guardian starts, and the dependency rule allows that in the iCloud Photos adapter only, so it needs a second allowed place or Tesseract through a library; and the proof skips in CI with a stated reason until the workflow installs `bubblewrap` on the runner, so today the gate proves the isolation on a developer machine only. On a Mac nothing was measured: bwrap does not exist there, and the likely mechanism is `sandbox-exec` with a profile that denies network and file reads outside the given paths, which Apple marks deprecated but still ships; whether it runs on current macOS, whether it blocks loopback and what it costs per asset are not measured and have to be verified on a Mac before the [collector](../../docs/concept/domain-language.md#collector) relies on it.

## Needs that are not in the repository

- `bubblewrap` on the CI runner: the isolation proof skips there, saying so, until the workflow installs it.

- Python 3 with the `pillow` and `pillow-heif` wheels unpacked (to encode the HEIC fixture only). Downloaded from PyPI into the cache.
- Tesseract language data for `por` and `deu` (not installed system-wide; only `eng` and `osd` are): the package `tesseract-ocr-por` and `tesseract-ocr-deu`. The spike downloaded `tessdata_fast` files (1.5 to 4 MB each) into the cache instead.
- CLIP model `Xenova/clip-vit-base-patch32`, 336 MB, downloaded from the Hugging Face hub on first run into the cache. Running it offline needs that cache copied to the server beforehand.
- Dependencies added to `backend/package.json` (dev): `sharp`, `heic-decode` (+ types), `@huggingface/transformers`.

## What this means

TypeScript carries all three risky things on this server: HEIC decoding (through the WASM library, since `sharp` cannot), a [phash](../../docs/concept/domain-language.md#phash) that matched across decoders and formats, and reading speeds (Tesseract at thousands of pages an hour, the vision model at about 550, text and photo embeddings in the 100,000-per-day range). The risks are that HEVC support lives only in a WASM build (speed on large camera files is unmeasured), that the phash threshold and the OCR candidate choice need real photos and scans that these made-up files cannot supply, and that the CLIP model has to be fetched from the internet once. Missing system packages are limited to the Tesseract language data.
