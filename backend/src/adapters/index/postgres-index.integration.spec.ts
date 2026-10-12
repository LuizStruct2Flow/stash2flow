// The contract of the index and the ledger on PostgreSQL. The same suites run
// against the fakes and against the real adapters, so the fakes cannot drift
// from the real things.
//
// The PostgreSQL side connects through the standard PGHOST, PGPORT, PGUSER,
// PGPASSWORD and PGDATABASE variables, creates and drops its own schema with
// a random name and never touches other data. When no database is reachable,
// it says so and is reported as skipped; it never passes silently.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test, { type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { search } from '../../application/search.ts'
import type { AssetRecord } from '../../domain/asset.ts'
import type { Index } from '../../ports/index.ts'
import type { Ledger } from '../../ports/ledger.ts'
import { FakeIndex } from '../../fakes/fake-index.ts'
import { FakeLedger } from '../../fakes/fake-ledger.ts'
import { PostgresIndex } from './postgres-index.ts'
import { PostgresLedger } from './postgres-ledger.ts'

const migration = fileURLToPath(new URL('migrations/0001-initial.sql', import.meta.url))

let unavailable: string | undefined
try {
  const probe = new Client()
  await probe.connect()
  await probe.end()
} catch (error) {
  unavailable =
    error instanceof Error ? error.message : 'the database gave an error that is not an Error'
  console.log(
    `PostgreSQL is not reachable (${unavailable}); the contract suites against the real adapters are skipped.`,
  )
}

interface World<A> {
  subject: A
  close(): Promise<void>
}

/** Hands the world to the body and closes it afterwards, on both sides alike. */
async function using<A>(
  world: Promise<World<A>>,
  body: (subject: A) => Promise<void>,
): Promise<void> {
  const opened = await world
  try {
    await body(opened.subject)
  } finally {
    await opened.close()
  }
}

const noClose = async () => {}

/** Runs the port contract against one index implementation. */
async function indexContract(t: TestContext, make: () => Promise<World<Index>>): Promise<void> {
  await t.test('keeps a source and answers it back', async () => {
    await using(make(), async (index) => {
      const source = { id: 'source-1', location: 'gdrive', account: 'user@example.com' }
      await index.keepSource(source)
      assert.deepEqual(await index.source('source-1'), source)
    })
  })

  await t.test('answers undefined for a source it does not hold', async () => {
    await using(make(), async (index) => {
      assert.equal(await index.source('no-such-source'), undefined)
    })
  })

  await t.test('lists the sources', async () => {
    await using(make(), async (index) => {
      await index.keepSource({ id: 'source-1', location: 'gdrive', account: 'user@example.com' })
      await index.keepSource({ id: 'source-2', location: 'onedrive', account: 'user@example.com' })
      const sources = await index.sources()
      assert.deepEqual(sources.map((source) => source.id).sort(), ['source-1', 'source-2'])
    })
  })

  await t.test('keeps an asset with its text and answers it back unchanged', async () => {
    await using(make(), async (index) => {
      await index.keepSource({ id: 'source-1', location: 'gdrive', account: 'user@example.com' })
      const record: AssetRecord = {
        sourceId: 'source-1',
        sourceAssetId: 'asset-1',
        name: 'receipt.pdf',
        size: 10,
        sha256: 'sha-1',
        ext: 'pdf',
        pages: 2,
        sourceLink: 'https://example.com/asset-1',
        ocrText: ['Certidão', 'rec1bo'],
        textLayerUsed: false,
        listedForUserAsNotCovered: true,
        assetDate: '2024-07-01T00:00:00.000Z',
        assetDateSource: "photo's own data",
      }
      await index.keepAsset(record)
      const assets = await index.assets()
      assert.equal(assets.length, 1)
      assert.deepEqual(assets[0], record)
    })
  })

  await t.test('stores an asset again under its identity, replacing what it held', async () => {
    await using(make(), async (index) => {
      await index.keepSource({ id: 'source-1', location: 'gdrive', account: 'user@example.com' })
      const identity = {
        sourceId: 'source-1',
        sourceAssetId: 'asset-again',
        name: 'first.pdf',
        size: 1,
        sha256: 'sha-first',
        ocrText: ['old text'],
      }
      await index.keepAsset(identity)
      await index.keepAsset({
        ...identity,
        name: 'second.pdf',
        sha256: 'sha-second',
        ocrText: ['new text'],
      })
      const assets = (await index.assets()).filter((asset) => asset.sourceAssetId === 'asset-again')
      assert.equal(assets.length, 1)
      assert.equal(assets[0].name, 'second.pdf')
      assert.deepEqual(assets[0].ocrText, ['new text'])
    })
  })

  await t.test('keeps an asset without text and answers back without text', async () => {
    await using(make(), async (index) => {
      await index.keepSource({ id: 'source-1', location: 'gdrive', account: 'user@example.com' })
      const record: AssetRecord = {
        sourceId: 'source-1',
        sourceAssetId: 'asset-no-text',
        name: 'photo.jpg',
        size: 3,
        sha256: 'sha-no-text',
      }
      await index.keepAsset(record)
      const assets = (await index.assets()).filter(
        (asset) => asset.sourceAssetId === 'asset-no-text',
      )
      assert.equal(assets.length, 1)
      assert.deepEqual(assets[0], record)
    })
  })

  await t.test('keeps a baseline per source and answers it back', async () => {
    await using(make(), async (index) => {
      await index.keepSource({ id: 'source-1', location: 'gdrive', account: 'user@example.com' })
      await index.keepBaseline('source-1', { assets: 3, bytes: 42 })
      assert.deepEqual(await index.baseline('source-1'), { assets: 3, bytes: 42 })
      await index.keepBaseline('source-1', { assets: 4, bytes: 43 })
      assert.deepEqual(await index.baseline('source-1'), { assets: 4, bytes: 43 })
    })
  })

  await t.test('answers undefined for a baseline it does not hold', async () => {
    await using(make(), async (index) => {
      assert.equal(await index.baseline('no-such-source'), undefined)
    })
  })
}

/** The search behaviours of slice 2, over one index implementation. */
async function searchContract(t: TestContext, make: () => Promise<World<Index>>): Promise<void> {
  await t.test('search ignores accents', async () => {
    await using(make(), async (index) => {
      await index.keepSource({ id: 'source-1', location: 'gdrive', account: 'user@example.com' })
      await index.keepAsset({
        sourceId: 'source-1',
        sourceAssetId: 'asset-accent',
        name: 'certidao.pdf',
        size: 1,
        sha256: 'sha-accent',
        ocrText: ['Certidão'],
      })
      const matches = await search(index, 'certidao')
      assert.ok(matches.some((match) => match.sourceAssetId === 'asset-accent'))
    })
  })

  await t.test('search tolerates one misread character', async () => {
    await using(make(), async (index) => {
      await index.keepSource({ id: 'source-1', location: 'gdrive', account: 'user@example.com' })
      await index.keepAsset({
        sourceId: 'source-1',
        sourceAssetId: 'asset-misread',
        name: 'recibo.pdf',
        size: 1,
        sha256: 'sha-misread',
        ocrText: ['rec1bo'],
        sourceLink: 'https://example.com/asset-misread',
      })
      const matches = await search(index, 'recibo')
      assert.ok(matches.some((match) => match.sourceAssetId === 'asset-misread'))
    })
  })

  await t.test('every word of the query is required', async () => {
    await using(make(), async (index) => {
      await index.keepSource({ id: 'source-1', location: 'gdrive', account: 'user@example.com' })
      await index.keepAsset({
        sourceId: 'source-1',
        sourceAssetId: 'asset-one-word',
        name: 'one.pdf',
        size: 1,
        sha256: 'sha-one-word',
        ocrText: ['Certidão'],
      })
      await index.keepAsset({
        sourceId: 'source-1',
        sourceAssetId: 'asset-two-words',
        name: 'two.pdf',
        size: 1,
        sha256: 'sha-two-words',
        ocrText: ['Certidão rec1bo'],
      })
      assert.equal((await search(index, 'certidao fatura')).length, 0)
      const matches = await search(index, 'certidao recibo')
      assert.deepEqual(matches.map((match) => match.sourceAssetId).sort(), ['asset-two-words'])
    })
  })

  await t.test('every match carries the source_link of its asset', async () => {
    await using(make(), async (index) => {
      await index.keepSource({ id: 'source-1', location: 'gdrive', account: 'user@example.com' })
      await index.keepAsset({
        sourceId: 'source-1',
        sourceAssetId: 'asset-linked',
        name: 'linked.pdf',
        size: 1,
        sha256: 'sha-linked',
        ocrText: ['recibo'],
        sourceLink: 'https://example.com/asset-linked',
      })
      const matches = await search(index, 'recibo')
      const linked = matches.filter((match) => match.sourceAssetId === 'asset-linked')
      assert.equal(linked.length, 1)
      assert.equal(linked[0].sourceLink, 'https://example.com/asset-linked')
    })
  })
}

interface LedgerWorld {
  ledger: Ledger
  index: Index
  started(): Promise<string[]>
  finished(): Promise<string[]>
}

/** Runs the port contract against one ledger implementation. */
async function ledgerContract(
  t: TestContext,
  make: () => Promise<World<LedgerWorld>>,
): Promise<void> {
  await t.test('stores a batch of asset records onto the index', async () => {
    await using(make(), async ({ ledger, index }) => {
      await index.keepSource({ id: 'source-1', location: 'gdrive', account: 'user@example.com' })
      await ledger.takeAssetRecords([
        {
          sourceId: 'source-1',
          sourceAssetId: 'asset-ledger-1',
          name: 'one.pdf',
          size: 1,
          sha256: 'sha-one',
        },
      ])
      const assets = (await index.assets()).filter(
        (asset) => asset.sourceAssetId === 'asset-ledger-1',
      )
      assert.equal(assets.length, 1)
      assert.equal(assets[0].name, 'one.pdf')
    })
  })

  await t.test('a batch delivered twice changes nothing', async () => {
    await using(make(), async ({ ledger, index }) => {
      await index.keepSource({ id: 'source-1', location: 'gdrive', account: 'user@example.com' })
      const record = {
        sourceId: 'source-1',
        sourceAssetId: 'asset-twice',
        name: 'twice.pdf',
        size: 1,
        sha256: 'sha-twice',
      }
      await ledger.takeAssetRecords([record])
      await ledger.takeAssetRecords([{ ...record }])
      const assets = (await index.assets()).filter((asset) => asset.sourceAssetId === 'asset-twice')
      assert.equal(assets.length, 1)
    })
  })

  await t.test('records the start and the finish of a run', async () => {
    await using(make(), async ({ ledger, index, started, finished }) => {
      await index.keepSource({ id: 'source-1', location: 'gdrive', account: 'user@example.com' })
      await ledger.startRun('source-1', '2026-01-01T00:00:00.000Z')
      await ledger.finishRun('source-1', '2026-01-01T00:01:00.000Z')
      assert.deepEqual(await started(), ['source-1'])
      assert.deepEqual(await finished(), ['source-1'])
    })
  })

  await t.test('records two runs of one source in order', async () => {
    await using(make(), async ({ ledger, index, started, finished }) => {
      await index.keepSource({ id: 'source-1', location: 'gdrive', account: 'user@example.com' })
      await ledger.startRun('source-1', '2026-01-01T00:00:00.000Z')
      await ledger.finishRun('source-1', '2026-01-01T00:01:00.000Z')
      await ledger.startRun('source-1', '2026-01-02T00:00:00.000Z')
      await ledger.finishRun('source-1', '2026-01-02T00:01:00.000Z')
      assert.deepEqual(await started(), ['source-1', 'source-1'])
      assert.deepEqual(await finished(), ['source-1', 'source-1'])
    })
  })
}

async function fakeIndexWorld(): Promise<World<Index>> {
  return { subject: new FakeIndex(), close: noClose }
}

async function fakeLedgerWorld(): Promise<World<LedgerWorld>> {
  const index = new FakeIndex()
  const ledger = new FakeLedger(index)
  return {
    subject: {
      ledger,
      index,
      started: async () => ledger.starts,
      finished: async () => ledger.finishes,
    },
    close: noClose,
  }
}

/** The world of one real adapter: a fresh schema with the migration applied. */
async function postgresWorld<A>(
  build: (client: Client, index: PostgresIndex) => A,
): Promise<World<A>> {
  const client = new Client()
  await client.connect()
  const schema = `contract_${randomBytes(8).toString('hex')}`
  try {
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}", public`)
    await client.query(await readFile(migration, 'utf8'))
  } catch (error) {
    await client.end()
    throw error
  }
  const index = new PostgresIndex(client)
  return {
    subject: build(client, index),
    close: async () => {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await client.end()
    },
  }
}

test('index contract: the fake', async (t) => {
  await indexContract(t, fakeIndexWorld)
})

test('search behaviours of slice 2: the fake', async (t) => {
  await searchContract(t, fakeIndexWorld)
})

test('ledger contract: the fake', async (t) => {
  await ledgerContract(t, fakeLedgerWorld)
})

test('index contract: PostgreSQL', { skip: unavailable ?? false }, async (t) => {
  await indexContract(t, async () => postgresWorld((client) => new PostgresIndex(client)))
})

test('search behaviours of slice 2: PostgreSQL', { skip: unavailable ?? false }, async (t) => {
  await searchContract(t, async () => postgresWorld((client) => new PostgresIndex(client)))
})

test('ledger contract: PostgreSQL', { skip: unavailable ?? false }, async (t) => {
  await ledgerContract(t, async () =>
    postgresWorld((client, index) => {
      const ledger = new PostgresLedger(index, client)
      const runs = async (finished: boolean) => {
        const result = await client.query(
          `SELECT source_id FROM run ${finished ? 'WHERE finished_at IS NOT NULL' : ''} ORDER BY id`,
        )
        return result.rows.map((row) => row.source_id as string)
      }
      return { ledger, index, started: () => runs(false), finished: () => runs(true) }
    }),
  )
})
