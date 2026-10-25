// The client of the API that the command line stash uses: it calls the API
// over HTTPS, carrying the command line's own credential. The server's
// certificate is verified — against the system's trust store, or against the
// certificate authority the configuration names on a local network.
import { request } from 'node:https'
import type { Match } from '../../application/search.ts'

export class ApiRefused extends Error {
  override name = 'ApiRefused'
  constructor() {
    super('The API refuses the call.')
  }
}

export interface ApiClientOptions {
  /** The PEM of the certificate authority to verify the server against, where it is not the system's. */
  ca?: string
}

export class HttpsApiClient {
  private readonly base: URL
  private readonly credential: string
  private readonly ca: string | undefined

  constructor(baseUrl: string, credential: string, options: ApiClientOptions = {}) {
    this.base = new URL(baseUrl)
    this.credential = credential
    this.ca = options.ca
  }

  /** Searches by words; throws ApiRefused when the API refuses the call. */
  search(words: string): Promise<Match[]> {
    const url = new URL('/search', this.base)
    url.searchParams.set('words', words)
    return this.call(url)
  }

  private call(url: URL): Promise<Match[]> {
    return new Promise<Match[]>((resolve, reject) => {
      const apiRequest = request(
        url,
        {
          headers: { authorization: `Bearer ${this.credential}` },
          ...(this.ca === undefined ? {} : { ca: this.ca }),
        },
        (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => chunks.push(chunk))
          response.on('end', () => {
            if (response.statusCode === 401) {
              reject(new ApiRefused())
              return
            }
            if (response.statusCode !== 200) {
              reject(new Error('The API answered with an error.'))
              return
            }
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Match[])
            } catch {
              reject(new Error('The answer of the API cannot be read.'))
            }
          })
        },
      )
      apiRequest.on('error', reject)
      apiRequest.end()
    })
  }
}
