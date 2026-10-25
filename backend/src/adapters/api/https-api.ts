// The API of the server (docs/concept/domain-language.md#api), a driving
// adapter served over HTTPS and nothing else: there is no plain HTTP listener.
// The certificate and the key are read from the paths the configuration names.
//
// Every call carries a client's credential; a call without a valid one — one
// that was never made, or a withdrawn one — is refused, and so the credential
// is never answered back, logged or held beyond recognising its digest. A call
// that is let in records when that client last called. Slice 2 serves search
// and nothing more.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:https'
import type { Match } from '../../application/search.ts'
import type { Clock } from '../../ports/clock.ts'

export interface ApiCalls {
  /** The client the credential belongs to, or undefined when the call must be refused. */
  recogniseClient(credential: string): Promise<string | undefined>
  /** Records when a client last called the API. */
  noteCall(client: string, at: string): Promise<void>
  /** The matches of a search. */
  search(words: string): Promise<Match[]>
}

export interface ApiServerConfig {
  /** The address to listen on; undefined listens on every address of the machine. */
  host?: string
  port: number
  certPath: string
  keyPath: string
}

export interface ApiServer {
  /** The port the server listens on; the given port, or the chosen one when it was 0. */
  port: number
  close(): Promise<void>
}

const refusedBody = JSON.stringify({ error: 'The API refuses the call.' })

export async function startApiServer(
  config: ApiServerConfig,
  calls: ApiCalls,
  clock: Clock,
  log: (line: string) => void,
): Promise<ApiServer> {
  const [cert, key] = await Promise.all([readFile(config.certPath), readFile(config.keyPath)])
  const server: Server = createServer({ cert, key }, (request, response) => {
    handle(request, response).catch(() => {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'The call failed.' }))
      log('A call failed.')
    })
  })

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'https://localhost')
    const credential = bearerCredential(request.headers.authorization)
    const client = credential === undefined ? undefined : await calls.recogniseClient(credential)
    if (client === undefined) {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(refusedBody)
      log('The API refused a call.')
      return
    }
    await calls.noteCall(client, clock.now())
    if (request.method !== 'GET' || url.pathname !== '/search') {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'The API does not serve this.' }))
      return
    }
    const words = url.searchParams.get('words') ?? ''
    const matches = await calls.search(words)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(matches))
  }

  await new Promise<void>((resolve) => {
    if (config.host === undefined) server.listen(config.port, resolve)
    else server.listen(config.port, config.host, resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string')
    throw new Error('The API server has no address.')
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

function bearerCredential(header: string | undefined): string | undefined {
  if (header === undefined) return undefined
  const [scheme, credential] = header.split(' ')
  if (scheme !== 'Bearer' || credential === undefined || credential === '') return undefined
  return credential
}
