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

## Needs that are not in the repository

- Python 3 with the `pillow` and `pillow-heif` wheels unpacked (to encode the HEIC fixture only). Downloaded from PyPI into the cache.
- Tesseract language data for `por` and `deu` (not installed system-wide; only `eng` and `osd` are): the package `tesseract-ocr-por` and `tesseract-ocr-deu`. The spike downloaded `tessdata_fast` files (1.5 to 4 MB each) into the cache instead.
- CLIP model `Xenova/clip-vit-base-patch32`, 336 MB, downloaded from the Hugging Face hub on first run into the cache. Running it offline needs that cache copied to the server beforehand.
- Dependencies added to `backend/package.json` (dev): `sharp`, `heic-decode` (+ types), `@huggingface/transformers`.

## What this means

TypeScript carries all three risky things on this server: HEIC decoding (through the WASM library, since `sharp` cannot), a [phash](../../docs/concept/domain-language.md#phash) that matched across decoders and formats, and reading speeds (Tesseract at thousands of pages an hour, the vision model at about 550, text and photo embeddings in the 100,000-per-day range). The risks are that HEVC support lives only in a WASM build (speed on large camera files is unmeasured), that the phash threshold and the OCR candidate choice need real photos and scans that these made-up files cannot supply, and that the CLIP model has to be fetched from the internet once. Missing system packages are limited to the Tesseract language data.
