import type { Credential } from '../domain/source.ts'

export interface SignIn {
  forAccount(provider: string, account: string, permission: 'read-only'): Promise<Credential>
  renew(credential: Credential): Promise<Credential | undefined>
}
