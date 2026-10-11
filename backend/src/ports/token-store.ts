import type { Credential } from '../domain/source.ts'

export interface TokenStore {
  keepBinding(provider: string, binding: string): Promise<void>
  bindingFor(provider: string): Promise<string | undefined>
  keepCredential(sourceId: string, credential: Credential): Promise<void>
  credentialFor(sourceId: string): Promise<Credential>
  removeCredential(sourceId: string): Promise<void>
}
