import { Given, Then, When } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { processAsset } from '../../src/application/process-asset.ts'
import { search } from '../../src/application/search.ts'
import { notBuilt } from '../support/not-built.ts'
import { resetSlice2, slice2 } from './slice-2.ts'

const keep = async (asset = slice2.assets[0]!) =>
  processAsset({
    asset,
    fileReading: slice2.fileReading,
    ocr: slice2.ocr,
    index: slice2.index,
    pageLimit: 10,
    sizeLimit: 100,
  })

Given('an asset that is a PDF with a text layer', () => {
  resetSlice2()
  slice2.assets = [
    {
      sourceId: 'source-1',
      sourceAssetId: 'asset-1',
      name: 'asset.pdf',
      ext: 'pdf',
      size: 1,
      sha256: 'sha-1',
    },
  ]
  slice2.fileReading.next = { textLayer: ['stored text'] }
})
Then('the text layer is used', async () =>
  assert.equal((await slice2.index.assets())[0]?.textLayerUsed, true),
)
Then('the asset is not sent to OCR', () => assert.equal(slice2.ocr.pages.length, 0))
Given('an asset that is an image', () => {
  resetSlice2()
  slice2.assets.push({
    sourceId: 'source-1',
    sourceAssetId: 'image-1',
    name: 'image.jpg',
    ext: 'jpg',
    size: 1,
    sha256: 'sha-1',
  })
  slice2.fileReading.next = { pagePictures: ['page'] }
  slice2.ocr.textByPage.set('page', 'text')
})
Given('an asset that is a PDF without a text layer', () => {
  slice2.assets.push({
    sourceId: 'source-1',
    sourceAssetId: 'pdf-1',
    name: 'asset.pdf',
    ext: 'pdf',
    size: 1,
    sha256: 'sha-2',
  })
})
When('the assets go through the pipeline', async () => {
  for (const asset of slice2.assets) await keep(asset)
})
Then('both assets get OCR', () => assert.equal(slice2.ocr.pages.length, 2))
Given('a PDF of two pages in Portuguese without a text layer', () => {
  resetSlice2()
  slice2.assets = [
    {
      sourceId: 'source-1',
      sourceAssetId: 'asset-1',
      name: 'asset.pdf',
      ext: 'pdf',
      size: 1,
      sha256: 'sha-1',
    },
  ]
  slice2.fileReading.next = { pagePictures: ['one', 'two'] }
  slice2.ocr.textByPage.set('one', 'página um')
  slice2.ocr.textByPage.set('two', 'página dois')
})
Then('the OCR text of each page is stored separately', async () =>
  assert.equal((await slice2.index.assets())[0]?.ocrText?.length, 2),
)
Then('the OCR text is stored in Portuguese', async () =>
  assert.deepEqual((await slice2.index.assets())[0]?.ocrText, ['página um', 'página dois']),
)
Given('an asset that is a word-processor file with some text in it', () => {
  resetSlice2()
  slice2.assets = [
    {
      sourceId: 'source-1',
      sourceAssetId: 'asset-1',
      name: 'asset.docx',
      ext: 'docx',
      size: 1,
      sha256: 'sha-1',
    },
  ]
  slice2.fileReading.next = { text: 'invented office text' }
})
Then('the guardian takes its text out', async () =>
  assert.deepEqual((await slice2.index.assets())[0]?.ocrText, ['invented office text']),
)
Then('a search for that text has a match for the asset', async () =>
  assert.equal((await search(slice2.index, 'office text'))[0]?.sourceAssetId, 'asset-1'),
)
Given('an asset that is an archive', () => {
  resetSlice2()
  slice2.assets = [
    {
      sourceId: 'source-1',
      sourceAssetId: 'archive-1',
      name: 'asset.zip',
      ext: 'zip',
      size: 2,
      sha256: 'sha-zip',
    },
  ]
})
Then('the name, size and hash of the asset are recorded', async () =>
  assert.deepEqual(await slice2.index.assets(), [
    { ...slice2.assets[0], listedForUserAsNotCovered: true },
  ]),
)
Then('the archive is not opened', () => assert.equal(slice2.fileReading.assets.length, 0))
Then('the archive is listed for the user as not covered', async () =>
  assert.equal((await slice2.index.assets())[0]?.listedForUserAsNotCovered, true),
)
Given('an asset that is a program', () => {
  resetSlice2()
  slice2.assets.push({
    sourceId: 'source-1',
    sourceAssetId: 'program-1',
    name: 'asset.exe',
    ext: 'exe',
    size: 1,
    sha256: 'sha-1',
  })
})
Given('an asset that is a file whose file type the app does not know', () => {
  slice2.assets.push({
    sourceId: 'source-1',
    sourceAssetId: 'unknown-1',
    name: 'asset.unknown',
    ext: 'unknown',
    size: 1,
    sha256: 'sha-2',
  })
})
Then('only the name, size and hash of each asset are recorded', async () =>
  assert.ok(
    (await slice2.index.assets()).every((asset) => asset.listedForUserAsNotCovered === true),
  ),
)
Then('the guardian never reads either asset', () =>
  assert.equal(slice2.fileReading.assets.length, 0),
)
Given('the user has set a limit of 10 pages', () => resetSlice2())
Given('an asset that is a PDF of 11 pages', () => {
  slice2.assets = [
    {
      sourceId: 'source-1',
      sourceAssetId: 'asset-1',
      name: 'asset.pdf',
      ext: 'pdf',
      size: 1,
      pages: 11,
      sha256: 'sha-1',
    },
  ]
})
Then('the guardian does not read the asset', () =>
  assert.equal(slice2.fileReading.assets.length, 0),
)
Given('an asset with a date taken in its own data and a different modification time', () => {
  resetSlice2()
  slice2.assets = [
    {
      sourceId: 'source-1',
      sourceAssetId: 'asset-1',
      name: 'asset.jpg',
      ext: 'jpg',
      size: 1,
      sha256: 'sha-1',
    },
  ]
  slice2.fileReading.next = { dateTaken: '2020-01-02', modificationTime: '2021-02-03' }
})
Then('the asset_date is the date taken', async () =>
  assert.equal((await slice2.index.assets())[0]?.assetDate, '2020-01-02'),
)
Then("the asset_date_source says that it came from the photo's own data", async () =>
  assert.equal((await slice2.index.assets())[0]?.assetDateSource, "photo's own data"),
)
Given('two sources', () => notBuilt())
When('the user sets that the videos of the first source are fetched', () => notBuilt())
When('the user sets that the videos of the second source are not fetched', () => notBuilt())
Then('the app stores that setting with each source', () => notBuilt())
Given('a source whose videos are fetched, holding a video', () => notBuilt())
When('the video goes through the pipeline', () => notBuilt())
Then('the video gets its hashes', () => notBuilt())
Then('the video gets a local copy', () => notBuilt())
Then('the video does not get OCR', () => notBuilt())
Given('a source whose videos are not fetched, holding a video', () => notBuilt())
Then('no bytes of the video are fetched', () => notBuilt())
Then("only the name, size and dates that the provider's listing gives are stored", () => notBuilt())
Then('the provider hash of the video is stored', () => notBuilt())
Given('a source for which the user has not set whether its videos are fetched', () => notBuilt())
Given('the source holds a video', () => notBuilt())
Then('the videos of the source are not fetched', () => notBuilt())
Given('an asset described as {string}', (_0: string) => notBuilt())
Then('the kind of the asset is {string}', (_0: string) => notBuilt())
Then('has_text is {string}', (_0: string) => notBuilt())
Given('an asset of kind document', () => notBuilt())
Given('an asset of kind photo', () => notBuilt())
Then('the asset of kind document gets a description', () => notBuilt())
Then('the asset of kind photo gets no description', () => notBuilt())
Given('an asset of kind document in Portuguese that names an institution', () => notBuilt())
Then('the description is one line', () => notBuilt())
Then('the description is in English', () => notBuilt())
Then('the name of the institution is written as it is in the asset', () => notBuilt())
Then('the doc_type of the asset is one of the doc_types of the vocabulary', () => notBuilt())
Given('an asset that was indexed before a pipeline step existed', () => notBuilt())
When('the user starts an ordinary run of its source', () => notBuilt())
Then('the asset does not get the step', () => notBuilt())
When('the user asks for re-indexing with the step', () => notBuilt())
Then('the asset gets the step', () => notBuilt())
Given('an asset already indexed with its local copy in the stash', () => notBuilt())
When('the user asks for re-indexing with a step', () => notBuilt())
