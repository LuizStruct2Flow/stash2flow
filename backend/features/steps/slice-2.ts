import type { Asset } from '../../src/domain/asset.ts'
import type { Source } from '../../src/domain/source.ts'
import { runSource } from '../../src/application/run.ts'
import { FakeClock } from '../../src/fakes/fake-clock.ts'
import { FakeFetching } from '../../src/fakes/fake-fetching.ts'
import { FakeFileReading } from '../../src/fakes/fake-file-reading.ts'
import { FakeIndex } from '../../src/fakes/fake-index.ts'
import { FakeLedger } from '../../src/fakes/fake-ledger.ts'
import { FakeOcr } from '../../src/fakes/fake-ocr.ts'
import { FakeSignIn } from '../../src/fakes/fake-sign-in.ts'
import { FakeStash } from '../../src/fakes/fake-stash.ts'
import { FakeTokenStore } from '../../src/fakes/fake-token-store.ts'
import type { FileReading } from '../../src/ports/file-reading.ts'
import type { Ocr } from '../../src/ports/ocr.ts'

export function newSlice2World() {
  const index = new FakeIndex()
  return {
    index,
    fetching: new FakeFetching(),
    ledger: new FakeLedger(index),
    stash: new FakeStash(),
    tokenStore: new FakeTokenStore(),
    signIn: new FakeSignIn(),
    fileReading: new FakeFileReading(),
    ocr: new FakeOcr(),
    /** The readers a scenario of the guardian's own puts in place of the fakes. */
    readers: undefined as { fileReading: FileReading; ocr: Ocr } | undefined,
    clock: new FakeClock(),
    source: undefined as Source | undefined,
    assets: [] as Asset[],
    /** Wide, so that only a scenario that sets a limit meets one. */
    limits: { pageLimit: 1000, sizeLimit: 1_000_000 },
    runResult: undefined as Awaited<ReturnType<typeof runSource>> | undefined,
  }
}

export let slice2 = newSlice2World()
export function resetSlice2(): void {
  slice2 = newSlice2World()
}

export async function keepSourceWithCredential(
  state: 'valid' | 'expires on a date' | 'expired' | 'missing' = 'valid',
  id = 'source-1',
): Promise<void> {
  slice2.source = { id, location: 'gdrive', account: 'user@example.com' }
  await slice2.index.keepSource(slice2.source)
  if (state !== 'missing')
    await slice2.tokenStore.keepCredential(slice2.source.id, {
      value: 'credential-private',
      state,
      account: slice2.source.account,
    })
}

export async function runCurrentSource(): Promise<void> {
  if (!slice2.source) throw new Error('The source does not exist.')
  slice2.fetching.assetsToFetch = slice2.assets
  slice2.runResult = await runSource({
    sourceId: slice2.source.id,
    fetching: slice2.fetching,
    ledger: slice2.ledger,
    index: slice2.index,
    stash: slice2.stash,
    tokenStore: slice2.tokenStore,
    signIn: slice2.signIn,
    fileReading: slice2.readers?.fileReading ?? slice2.fileReading,
    ocr: slice2.readers?.ocr ?? slice2.ocr,
    clock: slice2.clock,
    limits: slice2.limits,
  })
}

/** The assets of the world go through the pipeline as a run of a source does it. */
export async function processCurrentAsset(): Promise<void> {
  await keepSourceWithCredential()
  await runCurrentSource()
}
