import type { Source } from '../domain/source.ts'
import type { Index } from '../ports/index.ts'
import type { SignIn } from '../ports/sign-in.ts'
import type { TokenStore } from '../ports/token-store.ts'

export async function bind(
  tokenStore: TokenStore,
  provider: string,
  binding: string,
): Promise<void> {
  await tokenStore.keepBinding(provider, binding)
}

export async function addSource(
  index: Index,
  tokenStore: TokenStore,
  signIn: SignIn,
  source: Source,
): Promise<void> {
  const binding = await tokenStore.bindingFor(source.location)
  if (!binding) throw new Error('The app is not bound to the provider.')
  const credential = await signIn.forAccount(source.location, source.account, 'read-only')
  if (credential.account !== source.account)
    throw new Error('The credential is for another account.')
  await index.keepSource(source)
  await tokenStore.keepCredential(source.id, credential)
}

export async function listSources(index: Index, tokenStore: TokenStore) {
  return Promise.all(
    (await index.sources()).map(async (source) => {
      const credential = await tokenStore.credentialFor(source.id)
      return {
        ...source,
        credentialState: credential.state,
        ...(credential.lastUsed ? { lastUsed: credential.lastUsed } : {}),
      }
    }),
  )
}

export async function signInAgain(
  index: Index,
  tokenStore: TokenStore,
  signIn: SignIn,
  sourceId: string,
): Promise<void> {
  const source = await index.source(sourceId)
  if (!source) throw new Error('The source does not exist.')
  const credential = await signIn.forAccount(source.location, source.account, 'read-only')
  if (credential.account !== source.account)
    throw new Error("Sign-in must use the source's own account.")
  await tokenStore.keepCredential(sourceId, credential)
}

export async function removeCredential(tokenStore: TokenStore, sourceId: string): Promise<void> {
  await tokenStore.removeCredential(sourceId)
}
