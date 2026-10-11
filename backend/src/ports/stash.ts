export interface Stash {
  keep(sha256: string, bytes: Uint8Array): Promise<void>
}
