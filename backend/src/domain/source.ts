export interface Source {
  id: string
  location: string
  account: string
}

export type CredentialState = 'valid' | 'expires on a date' | 'expired' | 'missing'

export interface Credential {
  value: string
  state: CredentialState
  account: string
  expiresOn?: string
  lastUsed?: string
  canRenewWithoutUser?: boolean
}

export interface Baseline {
  assets: number
  bytes: number
}
