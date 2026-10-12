// The contract of the stash on disk. The same suite runs against the fake and
// against the real adapter, so the fake cannot drift from the real thing.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import type { Stash } from '../../ports/stash.ts'
import { FakeStash } from '../../fakes/fake-stash.ts'
import { DiskStash } from './disk-stash.ts'

interface LocalCopy {
  sha256: string
  bytes: Uint8Array
}

interface StashWorld {
  stash: Stash
  /** Every local copy kept, addressed by its sha256. */
  kept(): Promise<LocalCopy[]>
}

async function stashContract(
  t: TestContext,
  make: () => Promise<{ world: StashWorld; close(): Promise<void> }>,
): Promise<void> {
  await t.test('keeps a local copy addressed by its sha256', async () => {
    const { world, close } = await make()
    try {
      const bytes = new TextEncoder().encode('made-up bytes of an asset')
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      await world.stash.keep(sha256, bytes)
      const kept = await world.kept()
      assert.equal(kept.length, 1)
      assert.equal(kept[0].sha256, sha256)
      assert.deepEqual(Buffer.from(kept[0].bytes), Buffer.from(bytes))
    } finally {
      await close()
    }
  })

  await t.test('keeps the same bytes once', async () => {
    const { world, close } = await make()
    try {
      const bytes = new TextEncoder().encode('the same bytes arriving from two sources')
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      await world.stash.keep(sha256, bytes)
      await world.stash.keep(sha256, bytes)
      assert.equal((await world.kept()).length, 1)
    } finally {
      await close()
    }
  })
}

test('stash contract: the fake', async (t) => {
  await stashContract(t, async () => {
    const stash = new FakeStash()
    return {
      world: {
        stash,
        kept: async () => [...stash.localCopies].map(([sha256, bytes]) => ({ sha256, bytes })),
      },
      close: async () => {},
    }
  })
})

test('the stash on disk refuses an address that is not the sha256 of the bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stash2flow-stash-'))
  try {
    const stash = new DiskStash(join(directory, 'stash'))
    const bytes = new TextEncoder().encode('made-up bytes')
    await assert.rejects(stash.keep('../escaped', bytes), /do not match/)
    await assert.rejects(stash.keep('0'.repeat(64), bytes), /do not match/)
    assert.deepEqual(await readdir(directory), [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('stash contract: a directory on disk', async (t) => {
  await stashContract(t, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'stash2flow-stash-'))
    return {
      world: {
        stash: new DiskStash(directory),
        kept: async () => {
          const names = (await readdir(directory)).filter((name) => !name.endsWith('.part'))
          const copies: LocalCopy[] = []
          for (const name of names) {
            copies.push({ sha256: name, bytes: await readFile(join(directory, name)) })
          }
          return copies
        },
      },
      close: async () => {
        await rm(directory, { recursive: true, force: true })
      },
    }
  })
})
