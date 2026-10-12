import { createHash } from 'node:crypto'
import { access, mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Stash } from '../../ports/stash.ts'

/**
 * The stash on disk: local copies kept under one directory given by
 * configuration, addressed by their sha256, so the same bytes are kept once.
 * A copy is written under a provisional name and renamed, so a stop in the
 * middle never leaves bytes cut short at their address.
 */
export class DiskStash implements Stash {
  private readonly directory: string

  constructor(directory: string) {
    this.directory = directory
  }

  async keep(sha256: string, bytes: Uint8Array): Promise<void> {
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== sha256) throw new Error('The bytes do not match their sha256.')
    await mkdir(this.directory, { recursive: true })
    const path = join(this.directory, sha256)
    if (await this.alreadyKept(path)) return
    const provisional = join(this.directory, `${sha256}.part-${process.pid}`)
    await writeFile(provisional, bytes)
    await rename(provisional, path)
  }

  private async alreadyKept(path: string): Promise<boolean> {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  }
}
