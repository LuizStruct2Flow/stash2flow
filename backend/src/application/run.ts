import type { Baseline } from '../domain/source.ts'
import type { Clock } from '../ports/clock.ts'
import type { Fetching } from '../ports/fetching.ts'
import type { FileReading } from '../ports/file-reading.ts'
import type { Index } from '../ports/index.ts'
import type { Ledger } from '../ports/ledger.ts'
import type { Ocr } from '../ports/ocr.ts'
import type { SignIn } from '../ports/sign-in.ts'
import type { Stash } from '../ports/stash.ts'
import type { TokenStore } from '../ports/token-store.ts'
import { processAsset } from './process-asset.ts'

interface RunSourceInput {
  sourceId: string
  fetching: Fetching
  ledger: Ledger
  index: Index
  stash: Stash
  tokenStore: TokenStore
  signIn: SignIn
  fileReading: FileReading
  ocr: Ocr
  clock: Clock
}

export async function runSource(
  input: RunSourceInput,
): Promise<
  | { started: false; needsUserToSignInAgain: true }
  | { started: true; totalSize: number; baseline: Baseline }
> {
  const source = await input.index.source(input.sourceId)
  if (!source) throw new Error('The source does not exist.')
  let credential = await input.tokenStore.credentialFor(input.sourceId)
  if (credential.state === 'expired' && credential.canRenewWithoutUser) {
    const renewed = await input.signIn.renew(credential)
    if (renewed) {
      credential = renewed
      await input.tokenStore.keepCredential(input.sourceId, credential)
    }
  }
  if (credential.state === 'missing' || credential.state === 'expired') {
    return { started: false, needsUserToSignInAgain: true }
  }
  await input.ledger.startRun(source.id, input.clock.now())
  const totalSize = await input.fetching.sourceTotalSize(source)
  const assets = await input.fetching.fetch(source)
  for (const asset of assets) {
    if (asset.bytes) await input.stash.keep(asset.sha256, asset.bytes)
    await processAsset({
      asset,
      fileReading: input.fileReading,
      ocr: input.ocr,
      index: input.index,
      pageLimit: Number.MAX_SAFE_INTEGER,
      sizeLimit: Number.MAX_SAFE_INTEGER,
    })
  }
  const baseline = {
    assets: assets.length,
    bytes: assets.reduce((total, asset) => total + asset.size, 0),
  }
  await input.index.keepBaseline(source.id, baseline)
  await input.ledger.finishRun(source.id, input.clock.now())
  return { started: true, totalSize, baseline }
}
