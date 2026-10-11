import assert from 'node:assert/strict'
import test from 'node:test'
import { FakeFileReading } from '../fakes/fake-file-reading.ts'
import { FakeIndex } from '../fakes/fake-index.ts'
import { FakeOcr } from '../fakes/fake-ocr.ts'
import { processAsset } from './process-asset.ts'

test('a PDF text layer is used without OCR', async () => {
  const fileReading = new FakeFileReading()
  fileReading.next = { textLayer: ['stored text'], pages: 1 }
  const ocr = new FakeOcr()
  const index = new FakeIndex()
  await processAsset({
    asset: {
      sourceId: 'source-1',
      sourceAssetId: 'asset-1',
      name: 'one.pdf',
      size: 1,
      sha256: 'sha-1',
      ext: 'pdf',
    },
    fileReading,
    ocr,
    index,
    pageLimit: 10,
    sizeLimit: 10,
  })
  assert.equal(ocr.pages.length, 0)
  assert.deepEqual((await index.assets())[0]?.ocrText, ['stored text'])
})

test('a PDF without a text layer gets OCR per page', async () => {
  const fileReading = new FakeFileReading()
  fileReading.next = { pagePictures: ['page-1', 'page-2'], pages: 2 }
  const ocr = new FakeOcr()
  ocr.textByPage.set('page-1', 'página um')
  ocr.textByPage.set('page-2', 'página dois')
  const index = new FakeIndex()
  await processAsset({
    asset: {
      sourceId: 'source-1',
      sourceAssetId: 'asset-1',
      name: 'one.pdf',
      size: 1,
      sha256: 'sha-1',
      ext: 'pdf',
    },
    fileReading,
    ocr,
    index,
    pageLimit: 10,
    sizeLimit: 10,
  })
  assert.deepEqual((await index.assets())[0]?.ocrText, ['página um', 'página dois'])
})

test('archives, programs and unknown file types are recorded without being read', async () => {
  for (const ext of ['zip', 'exe', 'unknown']) {
    const fileReading = new FakeFileReading()
    const index = new FakeIndex()
    await processAsset({
      asset: {
        sourceId: 'source-1',
        sourceAssetId: ext,
        name: `one.${ext}`,
        size: 1,
        sha256: `sha-${ext}`,
        ext,
      },
      fileReading,
      ocr: new FakeOcr(),
      index,
      pageLimit: 10,
      sizeLimit: 10,
    })
    assert.equal(fileReading.assets.length, 0)
    assert.equal((await index.assets())[0]?.listedForUserAsNotCovered, true)
  }
})

test('an asset beyond the size or page limit is not read', async () => {
  const fileReading = new FakeFileReading()
  await processAsset({
    asset: {
      sourceId: 'source-1',
      sourceAssetId: 'asset-1',
      name: 'one.pdf',
      size: 11,
      sha256: 'sha-1',
      ext: 'pdf',
      pages: 11,
    },
    fileReading,
    ocr: new FakeOcr(),
    index: new FakeIndex(),
    pageLimit: 10,
    sizeLimit: 10,
  })
  assert.equal(fileReading.assets.length, 0)
})

test('an image gets OCR and an office document gets its text', async () => {
  const index = new FakeIndex()
  const imageReading = new FakeFileReading()
  imageReading.next = { pagePictures: ['page'] }
  const ocr = new FakeOcr()
  ocr.textByPage.set('page', 'image text')
  await processAsset({
    asset: {
      sourceId: 'source-1',
      sourceAssetId: 'image',
      name: 'one.jpg',
      size: 1,
      sha256: 'sha-image',
      ext: 'jpg',
    },
    fileReading: imageReading,
    ocr,
    index,
    pageLimit: 10,
    sizeLimit: 10,
  })
  const officeReading = new FakeFileReading()
  officeReading.next = { text: 'office text', modificationTime: '2020-01-01' }
  await processAsset({
    asset: {
      sourceId: 'source-1',
      sourceAssetId: 'office',
      name: 'one.docx',
      size: 1,
      sha256: 'sha-office',
      ext: 'docx',
    },
    fileReading: officeReading,
    ocr,
    index,
    pageLimit: 10,
    sizeLimit: 10,
  })
  assert.deepEqual(
    (await index.assets()).map((asset) => asset.ocrText),
    [['image text'], ['office text']],
  )
})
