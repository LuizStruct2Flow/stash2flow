import type { Credential } from '../domain/source.ts'
import type { TokenStore } from '../ports/token-store.ts'

const missing = (): Credential => ({ value: '', state: 'missing', account: '' })

export class FakeTokenStore implements TokenStore {
  private readonly bindings = new Map<string, string>()
  private readonly credentials = new Map<string, Credential>()
  async keepBinding(provider: string, binding: string): Promise<void> {
    this.bindings.set(provider, binding)
  }
  async bindingFor(provider: string): Promise<string | undefined> {
    return this.bindings.get(provider)
  }
  async keepCredential(sourceId: string, credential: Credential): Promise<void> {
    this.credentials.set(sourceId, structuredClone(credential))
  }
  async credentialFor(sourceId: string): Promise<Credential> {
    return structuredClone(this.credentials.get(sourceId) ?? missing())
  }
  async removeCredential(sourceId: string): Promise<void> {
    const credential = this.credentials.get(sourceId)
    this.credentials.set(sourceId, {
      ...missing(),
      account: credential?.account ?? '',
      ...(credential?.lastUsed ? { lastUsed: credential.lastUsed } : {}),
    })
  }
}
