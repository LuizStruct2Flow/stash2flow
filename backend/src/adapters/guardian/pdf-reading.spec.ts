import assert from 'node:assert/strict'
import test from 'node:test'
import { pdfDate } from './pdf-reading.ts'

test('a PDF date becomes an ISO date-time', () => {
  assert.equal(pdfDate("D:20240131120000+01'00'"), '2024-01-31T12:00:00+01:00')
  assert.equal(pdfDate('D:20240131120000Z'), '2024-01-31T12:00:00Z')
  assert.equal(pdfDate('D:20240131120000'), '2024-01-31T12:00:00Z')
  assert.equal(pdfDate('D:2024'), '2024-01-01T00:00:00Z')
  assert.equal(pdfDate('yesterday'), undefined)
  assert.equal(pdfDate(undefined), undefined)
})
