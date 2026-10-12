import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { open, readFile, rename, writeFile } from 'node:fs/promises'
import type { Credential } from '../../domain/source.ts'
import type { TokenStore } from '../../ports/token-store.ts'

const keyBytes = 32
const aad = 'stash2flow token store v1'

/**
 * Reads the key of the token store from the key file the configuration names.
 * The key is 32 bytes; anything else is refused. The key is never printed.
 */
export async function readKeyFile(path: string): Promise<Uint8Array> {
  let key: Uint8Array
  try {
    key = await readFile(path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      throw new Error(`The key file at ${path} does not exist.`)
    throw error
  }
  if (key.length !== keyBytes)
    throw new Error(`The key file at ${path} must hold ${keyBytes} bytes.`)
  return key
}

/** Creates a new key file with a random key, for the first run of the app. */
export async function writeNewKeyFile(path: string): Promise<void> {
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.write(randomBytes(keyBytes))
  } finally {
    await handle.close()
  }
}

interface Stored {
  bindings: Record<string, string>
  credentials: Record<string, Credential>
}

const empty = (): Stored => ({ bindings: {}, credentials: {} })

const missing = (credential?: Credential): Credential => ({
  value: '',
  state: 'missing',
  account: credential?.account ?? '',
  ...(credential?.lastUsed ? { lastUsed: credential.lastUsed } : {}),
})

/**
 * The token store as an encrypted file: the app's binding to each provider
 * and each source's credential, encrypted at rest with AES-256-GCM and the
 * key of the key file. Nothing of the store is ever printed in full: every
 * error message is constant and carries no value of the store.
 */
export class EncryptedFileTokenStore implements TokenStore {
  private readonly file: string
  private readonly key: Uint8Array

  constructor(file: string, key: Uint8Array) {
    if (key.length !== keyBytes) throw new Error(`The key must hold ${keyBytes} bytes.`)
    this.file = file
    this.key = key
  }

  async keepBinding(provider: string, binding: string): Promise<void> {
    const stored = await this.read()
    stored.bindings[provider] = binding
    await this.write(stored)
  }

  async bindingFor(provider: string): Promise<string | undefined> {
    return (await this.read()).bindings[provider]
  }

  async keepCredential(sourceId: string, credential: Credential): Promise<void> {
    const stored = await this.read()
    stored.credentials[sourceId] = structuredClone(credential)
    await this.write(stored)
  }

  async credentialFor(sourceId: string): Promise<Credential> {
    const credential = (await this.read()).credentials[sourceId]
    return structuredClone(credential ?? missing())
  }

  async removeCredential(sourceId: string): Promise<void> {
    const stored = await this.read()
    stored.credentials[sourceId] = missing(stored.credentials[sourceId])
    await this.write(stored)
  }

  private async read(): Promise<Stored> {
    let envelope: { iv: string; tag: string; data: string }
    try {
      envelope = JSON.parse(await readFile(this.file, 'utf8'))
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return empty()
      throw new Error('The token store cannot be read.')
    }
    let plain: Buffer
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64'))
      decipher.setAAD(Buffer.from(aad))
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
      plain = Buffer.concat([
        decipher.update(Buffer.from(envelope.data, 'base64')),
        decipher.final(),
      ])
    } catch {
      throw new Error('The token store cannot be read with this key.')
    }
    try {
      return JSON.parse(plain.toString('utf8')) as Stored
    } catch {
      throw new Error('The token store cannot be read.')
    }
  }

  private async write(stored: Stored): Promise<void> {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(Buffer.from(aad))
    const data = Buffer.concat([cipher.update(JSON.stringify(stored)), cipher.final()])
    const envelope = {
      version: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    }
    const provisional = `${this.file}.part-${process.pid}`
    await writeFile(provisional, JSON.stringify(envelope), { mode: 0o600 })
    await rename(provisional, this.file)
  }
}
