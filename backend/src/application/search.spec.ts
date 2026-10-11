import assert from 'node:assert/strict'
import test from 'node:test'
import { FakeIndex } from '../fakes/fake-index.ts'
import { search } from './search.ts'

test('search answers with matching assets and their source_link', async () => {
  const index = new FakeIndex()
  await index.keepAsset({
    sourceId: 'source-1',
    sourceAssetId: 'asset-1',
    name: 'receipt.pdf',
    size: 10,
    sha256: 'sha-1',
    sourceLink: 'https://example.com/asset-1',
    ocrText: ['Certidão rec1bo'],
  })

  assert.deepEqual(await search(index, 'certidao'), [
    { sourceAssetId: 'asset-1', sourceLink: 'https://example.com/asset-1' },
  ])
  assert.equal((await search(index, 'recibo')).length, 1)
  await index.keepAsset({
    sourceId: 'source-1',
    sourceAssetId: 'asset-2',
    name: 'empty.pdf',
    size: 1,
    sha256: 'sha-2',
  })
  assert.equal((await search(index, 'missing')).length, 0)
})
