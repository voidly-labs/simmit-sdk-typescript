// Internal request layer: header assembly, per-attempt timeout/abort
// composition, retry with backoff + Retry-After, idempotency-key injection,
// and error mapping. Not exported from the package.
import { APIPromise } from '../api-promise'
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError
} from '../error'
import type { RequestOptions } from '../client'

export interface ClientConfig {
  secretKey: string
  baseURL: string
  timeout: number
  maxRetries: number
  defaultHeaders: Record<string, string | null | undefined> | undefined
  fetch: typeof globalThis.fetch
  fetchOptions: RequestInit | undefined
}

export interface RequestSpec {
  method: 'GET' | 'POST'
  path: string
  body?: unknown
  /** POST job creation: auto-generate an idempotency-key when none supplied. */
  idempotent?: boolean
}

// Retry policy constants (DESIGN §6) — typed code config, not env.
const INITIAL_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 8_000
const MAX_RETRY_AFTER_MS = 60_000

export function makeRequest<T>(
  config: ClientConfig,
  spec: RequestSpec,
  options: RequestOptions = {}
): APIPromise<T> {
  return new APIPromise(run<T>(config, spec, options))
}

async function run<T>(
  config: ClientConfig,
  spec: RequestSpec,
  options: RequestOptions
): Promise<{ data: T; response: Response }> {
  const maxRetries = options.maxRetries ?? config.maxRetries
  const timeout = options.timeout ?? config.timeout
  const headers = buildHeaders(config, spec, options)
  const url = `${config.baseURL.replace(/\/+$/, '')}${spec.path}`
  const body = spec.body === undefined ? undefined : JSON.stringify(spec.body)

  for (let attempt = 0; ; attempt++) {
    throwIfUserAborted(options.signal)

    let result: AttemptResult
    try {
      result = await fetchAttempt(config, spec, options, {
        url,
        headers,
        body,
        timeout
      })
    } catch (err) {
      if (err instanceof APIUserAbortError) throw err
      // Connection error, malformed success body, or per-attempt timeout —
      // all retryable.
      if (attempt < maxRetries) {
        await backoff(attempt, undefined, options.signal)
        continue
      }
      throw err
    }

    const { response, json } = result

    if (response.ok) {
      return { data: json as T, response }
    }

    if (shouldRetryStatus(response.status) && attempt < maxRetries) {
      await backoff(
        attempt,
        response.headers.get('retry-after'),
        options.signal
      )
      continue
    }

    throw APIError.generate(
      response.status,
      typeof json === 'object' && json !== null ? json : undefined,
      response.statusText,
      response.headers
    )
  }
}

interface AttemptResult {
  response: Response
  /** Parsed JSON body; undefined when an error response carried a non-JSON body. */
  json: unknown
}

async function fetchAttempt(
  config: ClientConfig,
  spec: RequestSpec,
  options: RequestOptions,
  attempt: {
    url: string
    headers: Record<string, string>
    body: string | undefined
    timeout: number
  }
): Promise<AttemptResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), attempt.timeout)
  const onUserAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onUserAbort, { once: true })

  try {
    const response = await config.fetch(attempt.url, {
      ...config.fetchOptions,
      method: spec.method,
      headers: attempt.headers,
      ...(attempt.body !== undefined ? { body: attempt.body } : {}),
      signal: controller.signal
    })

    // The body is read inside the timed scope too — a stalled body must not
    // hang past the per-attempt timeout (fetch ties the body stream to the
    // controller's signal, so the abort cancels the read).
    let json: unknown
    if (response.ok) {
      // Success bodies must parse; a truncated/malformed one is treated as a
      // transport failure (classified below) and retried like one.
      json = await response.json()
    } else {
      try {
        json = await response.json()
      } catch (err) {
        // Aborted mid-read is a timeout/abort, not a non-JSON body.
        if (controller.signal.aborted) throw err
        json = undefined // e.g. a load-balancer HTML error page
      }
    }
    return { response, json }
  } catch (err) {
    if (options.signal?.aborted) throw new APIUserAbortError()
    if (controller.signal.aborted) {
      throw new APIConnectionTimeoutError()
    }
    throw new APIConnectionError({
      cause: err instanceof Error ? err : undefined
    })
  } finally {
    clearTimeout(timeoutId)
    options.signal?.removeEventListener('abort', onUserAbort)
  }
}

function buildHeaders(
  config: ClientConfig,
  spec: RequestSpec,
  options: RequestOptions
): Record<string, string> {
  const idempotent = spec.idempotent && spec.method === 'POST'
  const merged: Record<string, string | null | undefined> = {
    authorization: `Bearer ${config.secretKey}`,
    ...(spec.body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...(idempotent && !options.idempotencyKey
      ? {
          // Generated once per call and reused across retry attempts — that
          // is what makes POST retries safe by default (DESIGN §6). The auto
          // key is an SDK built-in default (lowest tier), so defaultHeaders
          // may override it.
          'idempotency-key': `simmit-node-retry-${crypto.randomUUID()}`
        }
      : {}),
    ...lowercaseKeys(config.defaultHeaders),
    ...(idempotent && options.idempotencyKey
      ? {
          // An explicit key is a per-request option: it must beat constructor
          // defaultHeaders (DESIGN §3). Raw options.headers still wins last.
          'idempotency-key': options.idempotencyKey
        }
      : {}),
    ...lowercaseKeys(options.headers)
  }

  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(merged)) {
    // A null value deletes the header (DESIGN §3); undefined entries are skipped.
    if (typeof value === 'string') headers[key] = value
  }
  return headers
}

function lowercaseKeys(
  record: Record<string, string | null | undefined> | undefined
): Record<string, string | null | undefined> {
  if (!record) return {}
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key.toLowerCase(), value])
  )
}

function shouldRetryStatus(status: number): boolean {
  // 408 kept defensively even though the API never emits it. 409 is never
  // retried: result_not_ready is thrown immediately by design and the other
  // 409s are deterministic (DESIGN §6).
  return status === 408 || status === 429 || status >= 500
}

async function backoff(
  attempt: number,
  retryAfterHeader: string | null | undefined,
  signal: AbortSignal | undefined
): Promise<void> {
  const retryAfterMs = parseRetryAfter(retryAfterHeader)
  const delay =
    retryAfterMs !== undefined
      ? retryAfterMs
      : Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS) *
        (1 - 0.25 * Math.random())
  await sleep(delay, signal)
}

/** Accepts `Retry-After` only when it parses to a delay in (0, 60s] — the SDK never sleeps arbitrarily long on a server hint (DESIGN §6). */
function parseRetryAfter(
  header: string | null | undefined
): number | undefined {
  if (!header) return undefined
  let ms: number
  if (/^\d+$/.test(header.trim())) {
    ms = Number(header.trim()) * 1000
  } else {
    ms = new Date(header).getTime() - Date.now()
  }
  return Number.isFinite(ms) && ms > 0 && ms <= MAX_RETRY_AFTER_MS
    ? ms
    : undefined
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfUserAborted(signal)
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timeoutId)
      reject(new APIUserAbortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function throwIfUserAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new APIUserAbortError()
}
