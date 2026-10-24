// What a reading, a script and a macro do when they run plainly, outside the
// guardian's isolation: the controls of the scenarios of
// features/trust-and-isolation.feature. Harness code, which may start a program
// where a step definition may not: never imported by src/.
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** The reading process run plainly, with the asset's bytes on its standard input. */
export function readPlainly(program: string, ext: string, bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [program, ext], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk: Buffer) => (out += chunk))
    child.stderr.on('data', (chunk: Buffer) => (err += chunk))
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`The plain reading failed: ${err}`)),
    )
    child.stdin.end(bytes)
  })
}

/** A JavaScript source run by node, as an engine that ran a script found in a document would. */
export async function runScript(source: string): Promise<string> {
  return (await run(process.execPath, ['-e', source])).stdout
}

/** A shell script run by the shell, as a program that was taken out of a document and run would. */
export async function runProgram(path: string): Promise<void> {
  await run('sh', [path])
}
