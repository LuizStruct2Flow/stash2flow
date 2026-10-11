import assert from 'node:assert/strict'
import test from 'node:test'
import type { Asset } from '../domain/asset.ts'
import { FakeFileReading } from '../fakes/fake-file-reading.ts'
import { FakeOcr } from '../fakes/fake-ocr.ts'
import { processAsset } from './process-asset.ts'

const limits = { pageLimit: 10, sizeLimit: 10 }

const asset = (ext: string, extra: Partial<Asset> = {}): Asset => ({
  sourceId: 'source-1',
  sourceAssetId: ext,
  name: `one.${ext}`,
  size: 1,
  sha256: `sha-${ext}`,
  ext,
  ...extra,
})

test('a PDF text layer is used without OCR', async () => {
  const fileReading = new FakeFileReading()
  fileReading.next = { textLayer: ['stored text'], pages: 1 }
  const ocr = new FakeOcr()
  const record = await processAsset({ asset: asset('pdf'), fileReading, ocr, ...limits })
  assert.equal(ocr.pages.length, 0)
  assert.deepEqual(record?.ocrText, ['stored text'])
})

test('a PDF without a text layer gets OCR per page', async () => {
  const fileReading = new FakeFileReading()
  fileReading.next = { pagePictures: ['page-1', 'page-2'], pages: 2 }
  const ocr = new FakeOcr()
  ocr.textByPage.set('page-1', 'página um')
  ocr.textByPage.set('page-2', 'página dois')
  const record = await processAsset({ asset: asset('pdf'), fileReading, ocr, ...limits })
  assert.deepEqual(record?.ocrText, ['página um', 'página dois'])
})

test('archives, programs and unknown file types are recorded without being read', async () => {
  for (const ext of ['zip', 'exe', 'unknown']) {
    const fileReading = new FakeFileReading()
    const record = await processAsset({
      asset: asset(ext),
      fileReading,
      ocr: new FakeOcr(),
      ...limits,
    })
    assert.equal(fileReading.assets.length, 0)
    assert.equal(record?.listedForUserAsNotCovered, true)
  }
})

test('an asset beyond the size or page limit is not read', async () => {
  const fileReading = new FakeFileReading()
  const record = await processAsset({
    asset: asset('pdf', { size: 11, pages: 11 }),
    fileReading,
    ocr: new FakeOcr(),
    ...limits,
  })
  assert.equal(fileReading.assets.length, 0)
  assert.equal(record, undefined)
})

test('an image gets OCR and an office document gets its text', async () => {
  const imageReading = new FakeFileReading()
  imageReading.next = { pagePictures: ['page'] }
  const ocr = new FakeOcr()
  ocr.textByPage.set('page', 'image text')
  const image = await processAsset({
    asset: asset('jpg'),
    fileReading: imageReading,
    ocr,
    ...limits,
  })
  const officeReading = new FakeFileReading()
  officeReading.next = { text: 'office text', modificationTime: '2020-01-01' }
  const office = await processAsset({
    asset: asset('docx'),
    fileReading: officeReading,
    ocr,
    ...limits,
  })
  assert.deepEqual([image?.ocrText, office?.ocrText], [['image text'], ['office text']])
})

test('the record never carries the bytes of the asset', async () => {
  for (const ext of ['zip', 'pdf']) {
    const record = await processAsset({
      asset: asset(ext, { bytes: new Uint8Array([1]) }),
      fileReading: new FakeFileReading(),
      ocr: new FakeOcr(),
      ...limits,
    })
    assert.ok(record)
    assert.equal('bytes' in record, false)
  }
})
