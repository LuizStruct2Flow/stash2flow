import { Given, Then, When } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import type { Match } from '../../src/application/search.ts'
import { search } from '../../src/application/search.ts'
import { FakeIndex } from '../../src/fakes/fake-index.ts'
import { notBuilt } from '../support/not-built.ts'

let index = new FakeIndex()
let answer: Match[] = []

Given('a source holding a scan of a receipt as a PDF with no text layer', async () => {
  index = new FakeIndex()
  await index.keepAsset({
    sourceId: 'source-1',
    sourceAssetId: 'scan-1',
    name: 'receipt.pdf',
    size: 1,
    sha256: 'sha-1',
    sourceLink: 'https://example.com/scan-1',
    ocrText: ['tax receipt'],
  })
})
Given('a run of the source has finished', () => {})
When('the user searches for words printed on the receipt', async () => {
  answer = await search(index, 'tax receipt')
})
Then('the answer has a match for the scan', () => assert.equal(answer[0]?.sourceAssetId, 'scan-1'))
Given('an asset whose OCR text says {string}', async (ocrText: string) => {
  index = new FakeIndex()
  await index.keepAsset({
    sourceId: 'source-1',
    sourceAssetId: 'asset-1',
    name: 'asset.pdf',
    size: 1,
    sha256: 'sha-1',
    sourceLink: 'https://example.com/asset-1',
    ocrText: [ocrText],
  })
})
When('the user searches for {string}', async (words: string) => {
  answer = await search(index, words)
})
Then('the answer has a match for that asset', () =>
  assert.equal(answer[0]?.sourceAssetId, 'asset-1'),
)
Then('every match in the answer carries the source_link of its asset', () =>
  assert.ok(answer.every((match) => match.sourceLink)),
)
Given('an asset whose OCR text says {string} that has vanished from its source', (_0: string) =>
  notBuilt(),
)
Then('the answer has no match for that asset', () => notBuilt())
When('the user makes an advanced search for {string} that includes vanished assets', (_0: string) =>
  notBuilt(),
)
Given('an asset of kind document with doc_type {string}', (_0: string) => notBuilt())
When('the user searches with the doc_type {string}', (_0: string) => notBuilt())
Then('the answer has a match for the asset with doc_type {string} only', (_0: string) => notBuilt())
Given("an asset of kind document about two persons on the user's list", () => notBuilt())
When('the user searches with the first person', () => notBuilt())
When('the user searches with the second person', () => notBuilt())
Given('an asset of kind document with the doc_date 2010-05-01', () => notBuilt())
Given('an asset of kind document with the doc_date 2020-05-01', () => notBuilt())
When('the user searches with the date range from 2005 to 2015', () => notBuilt())
Then('the answer has a match for the asset with the doc_date 2010-05-01 only', () => notBuilt())
Given('an asset of kind document with no doc_date and the asset_date 2010-05-01', () => notBuilt())
Given('a scan of a receipt in Portuguese whose OCR text has been read', () => notBuilt())
When('the user searches for English words that mean what the receipt says', () => notBuilt())
