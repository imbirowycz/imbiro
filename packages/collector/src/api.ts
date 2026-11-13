import { promisify } from 'node:util'
import { gzip } from 'node:zlib'
import type { CollectorClaimRequest, CollectorClaimResponse, CollectorResult } from '@myorg/shared'

const gzipAsync = promisify(gzip)

/** The two calls the collector makes to the main API. */
export interface CollectorApi {
  claim(): Promise<CollectorClaimResponse>
  report(result: CollectorResult): Promise<void>
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export function createApi(options: { apiUrl: string; token: string; hostname: string; fetchImpl?: typeof fetch }): CollectorApi {
  const fetchImpl = options.fetchImpl ?? fetch

  async function post(path: string, body: unknown): Promise<Response> {
    // Pages are a few MB of HTML — gzip makes the upload several times smaller.
    const response = await fetchImpl(`${options.apiUrl}/api/collector${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/json', 'content-encoding': 'gzip' },
      body: await gzipAsync(JSON.stringify(body)),
      signal: AbortSignal.timeout(60_000),
    })
    // 409 = the job expired meanwhile; the result is simply no longer wanted.
    if (!response.ok && response.status !== 409) throw new ApiError(`API ${path} → HTTP ${response.status}`, response.status)
    return response
  }

  return {
    async claim() {
      const request: CollectorClaimRequest = { hostname: options.hostname }
      return (await (await post('/claim', request)).json()) as CollectorClaimResponse
    },
    async report(result) {
      await (await post('/results', result)).body?.cancel()
    },
  }
}
