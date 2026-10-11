import type { Credential } from '../domain/source.ts'
import type { SignIn } from '../ports/sign-in.ts'

export class FakeSignIn implements SignIn {
  nextCredential: Credential = { value: 'credential', state: 'valid', account: 'user@example.com' }
  nextRenewedCredential: Credential | undefined
  permissions: string | undefined
  calls = 0
  async forAccount(
    _provider: string,
    _account: string,
    permission: 'read-only',
  ): Promise<Credential> {
    this.calls++
    this.permissions = permission
    return structuredClone(this.nextCredential)
  }
  async renew(_credential: Credential): Promise<Credential | undefined> {
    return structuredClone(this.nextRenewedCredential)
  }
}
