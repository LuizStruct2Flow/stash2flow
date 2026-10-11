import assert from 'node:assert/strict'
import test from 'node:test'
import { bestAssetDate, nameInNfc, textMatches } from './asset.ts'

test('nameInNfc stores a name in NFC', () => {
  assert.equal(nameInNfc('Certida\u0303o.pdf'), 'Certidão.pdf')
})

test('textMatches ignores accents and tolerates one OCR misreading', () => {
  assert.equal(textMatches('Certidão', 'certidao'), true)
  assert.equal(textMatches('rec1bo', 'recibo'), true)
  assert.equal(textMatches('another asset', 'receipt'), false)
})

test('bestAssetDate uses the date taken before the modification time', () => {
  assert.deepEqual(bestAssetDate({ dateTaken: '2020-01-02', modificationTime: '2021-02-03' }), {
    assetDate: '2020-01-02',
    assetDateSource: "photo's own data",
  })
})

test('bestAssetDate falls back to the modification time and can have no date', () => {
  assert.deepEqual(bestAssetDate({ modificationTime: '2021-02-03' }), {
    assetDate: '2021-02-03',
    assetDateSource: 'modification time',
  })
  assert.equal(bestAssetDate({}), undefined)
})

test('textMatches requires every query word', () => {
  assert.equal(textMatches('one receipt', 'one receipt'), true)
  assert.equal(textMatches('one receipt', 'one missing'), false)
})
