import { APIPromise } from './api-promise'
import { SimmitError } from './error'
import {
  makeRequest,
  type ClientConfig,
  type RequestSpec
} from './internal/request'

export interface ClientOptions {
  /** Defaults to process.env['SIMMIT_SECRET_KEY'] — exactly one env fallback. Construction
   *  throws SimmitError('Missing secret key. Pass secretKey or set SIMMIT_SECRET_KEY.').
   *  "Secret key" is the credential noun end to end (dashboard → docs → env var → option →
   *  error): it spends credits and must never ship client-side. */
  secretKey?: string | null
  /** Defaults to process.env['SIMMIT_BASE_URL'] ?? 'https://api.simmit.com'. */
  baseURL?: string | null
  /** Per-attempt timeout in ms. Default 60_000. (Retries can extend total wall time.) */
  timeout?: number
  /** Max retries after the first attempt for retryable failures. Default 2. */
  maxRetries?: number
  /** Headers sent with every request. Merged under per-request headers. */
  defaultHeaders?: Record<string, string | null | undefined>
  /** Custom fetch (testing, proxies). Defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch
  /** Extra RequestInit fields passed to every fetch call (e.g. undici dispatcher). */
  fetchOptions?: RequestInit
}

export interface RequestOptions {
  /** Per-attempt timeout in ms. Overrides ClientOptions.timeout. */
  timeout?: number
  /** Abort the call (including retries and waiting). Throws APIUserAbortError. Never retried. */
  signal?: AbortSignal
  /** Overrides ClientOptions.maxRetries for this call. */
  maxRetries?: number
  /** Merged over defaultHeaders; a null value deletes the header. */
  headers?: Record<string, string | null | undefined>
  /** jobs.create / jobs.createAndWait only: replaces the auto-generated idempotency-key. */
  idempotencyKey?: string
}

export default class Simmit {
  readonly baseURL: string

  readonly #config: ClientConfig

  constructor(options: ClientOptions = {}) {
    const secretKey = options.secretKey ?? readEnv('SIMMIT_SECRET_KEY')
    if (!secretKey) {
      throw new SimmitError(
        'Missing secret key. Pass secretKey or set SIMMIT_SECRET_KEY.'
      )
    }

    this.baseURL =
      options.baseURL ?? readEnv('SIMMIT_BASE_URL') ?? 'https://api.simmit.com'

    this.#config = {
      secretKey,
      baseURL: this.baseURL,
      timeout: options.timeout ?? 60_000,
      maxRetries: options.maxRetries ?? 2,
      defaultHeaders: options.defaultHeaders,
      fetch: options.fetch ?? globalThis.fetch,
      fetchOptions: options.fetchOptions
    }
  }

  /** @internal Resource classes route through here; not public surface. */
  _request<T>(spec: RequestSpec, options?: RequestOptions): APIPromise<T> {
    return makeRequest(this.#config, spec, options)
  }
}

function readEnv(name: string): string | undefined {
  if (typeof process === 'undefined') return undefined
  const value = process.env?.[name]?.trim()
  return value || undefined
}
