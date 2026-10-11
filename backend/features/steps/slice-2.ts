import type { Asset } from '../../src/domain/asset.ts'
import type { Source } from '../../src/domain/source.ts'
import { processAsset } from '../../src/application/process-asset.ts'
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

export function newSlice2World() {
  return {
    index: new FakeIndex(),
    fetching: new FakeFetching(),
    ledger: new FakeLedger(),
    stash: new FakeStash(),
    tokenStore: new FakeTokenStore(),
    signIn: new FakeSignIn(),
    fileReading: new FakeFileReading(),
    ocr: new FakeOcr(),
    clock: new FakeClock(),
    source: undefined as Source | undefined,
    assets: [] as Asset[],
    runResult: undefined as Awaited<ReturnType<typeof runSource>> | undefined,
  }
}

export let slice2 = newSlice2World()
export function resetSlice2(): void {
  slice2 = newSlice2World()
}

export async function keepSourceWithCredential(
  state: 'valid' | 'expires on a date' | 'expired' | 'missing' = 'valid',
): Promise<void> {
  slice2.source = { id: 'source-1', location: 'gdrive', account: 'user@example.com' }
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
    fileReading: slice2.fileReading,
    ocr: slice2.ocr,
    clock: slice2.clock,
  })
}

export async function processCurrentAsset(): Promise<void> {
  const asset = slice2.assets[0]
  if (!asset) throw new Error('The asset does not exist.')
  await processAsset({
    asset,
    fileReading: slice2.fileReading,
    ocr: slice2.ocr,
    index: slice2.index,
    pageLimit: 10,
    sizeLimit: 100,
  })
}
