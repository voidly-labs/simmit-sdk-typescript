import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Simmit from '../src/client'
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  InternalServerError,
  RateLimitError,
  SimmitError
} from '../src/error'

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

function makeClient(fetchMock: typeof globalThis.fetch, overrides = {}) {
  return new Simmit({
    secretKey: 'smt_sk_test',
    fetch: fetchMock,
    maxRetries: 2,
    ...overrides
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0) // jitter factor → 1.0 exactly
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Runs a request to completion, advancing fake timers through backoff sleeps. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  const guarded = promise.catch(err => ({ __err: err }) as const)
  await vi.runAllTimersAsync()
  const result = await guarded
  if (result && typeof result === 'object' && '__err' in (result as object)) {
    throw (result as { __err: unknown }).__err
  }
  return result as T
}

describe('request basics', () => {
  it('sends bearer auth and parses JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { purchased: 10 }))
    const client = makeClient(fetchMock)
    const data = await settle(
      client._request<{ purchased: number }>({ method: 'GET', path: '/v1/simc/credits' })
    )
    expect(data).toEqual({ purchased: 10 })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.simmit.com/v1/simc/credits')
    expect(init.headers.authorization).toBe('Bearer smt_sk_test')
    expect(init.method).toBe('GET')
  })

  it('exposes the raw response via withResponse/asResponse', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ok: 1 }, { 'x-idempotent-replay': 'true' }))
    const client = makeClient(fetchMock)
    const { data, response } = await settle(
      client._request<{ ok: number }>({ method: 'GET', path: '/x' }).withResponse()
    )
    expect(data).toEqual({ ok: 1 })
    expect(response.headers.get('x-idempotent-replay')).toBe('true')
  })

  it('merges headers with per-request precedence and null deletion', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}))
    const client = makeClient(fetchMock, {
      defaultHeaders: { 'x-default': 'a', 'x-both': 'default', 'x-gone': 'set' }
    })
    await settle(
      client._request(
        { method: 'GET', path: '/x' },
        { headers: { 'x-both': 'request', 'x-gone': null } }
      )
    )
    const headers = fetchMock.mock.calls[0]![1].headers
    expect(headers['x-default']).toBe('a')
    expect(headers['x-both']).toBe('request')
    expect('x-gone' in headers).toBe(false)
  })

  it('resolves the default fetch from globalThis lazily', async () => {
    // Construct before stubbing: a snapshot taken here would miss the stub.
    const client = new Simmit({ secretKey: 'smt_sk_test' })
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const data = await settle(client._request<{ ok: boolean }>({ method: 'GET', path: '/x' }))
      expect(data).toEqual({ ok: true })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('throws at construction without a secret key', () => {
    const previous = process.env.SIMMIT_SECRET_KEY
    delete process.env.SIMMIT_SECRET_KEY
    try {
      expect(() => new Simmit()).toThrow(SimmitError)
      expect(() => new Simmit()).toThrow(/SIMMIT_SECRET_KEY/)
    } finally {
      if (previous !== undefined) process.env.SIMMIT_SECRET_KEY = previous
    }
  })

  it('falls back to the SIMMIT_SECRET_KEY env var', () => {
    const previous = process.env.SIMMIT_SECRET_KEY
    process.env.SIMMIT_SECRET_KEY = 'smt_sk_env'
    try {
      expect(() => new Simmit()).not.toThrow()
    } finally {
      if (previous === undefined) delete process.env.SIMMIT_SECRET_KEY
      else process.env.SIMMIT_SECRET_KEY = previous
    }
  })
})

describe('retry policy', () => {
  it('retries 429 and 5xx then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: 'slow down', code: 'rate_limit_exceeded', meta: { scope: 'developer' } }))
      .mockResolvedValueOnce(jsonResponse(503, { error: 'maint', code: 'api_maintenance', meta: { retryAfterSeconds: 1 } }))
      .mockResolvedValueOnce(jsonResponse(200, { done: true }))
    const client = makeClient(fetchMock)
    const data = await settle(client._request({ method: 'GET', path: '/x' }))
    expect(data).toEqual({ done: true })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry non-429 4xx', async () => {
    for (const [status, body, cls] of [
      [400, { error: 'bad', code: 'missing_input', meta: null }, BadRequestError],
      [401, { error: 'nope', code: 'invalid_token', meta: null }, AuthenticationError],
      [409, { error: 'conflict', code: 'result_not_ready', meta: { status: 'running' } }, ConflictError]
    ] as const) {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(status, body))
      const client = makeClient(fetchMock)
      await expect(settle(client._request({ method: 'GET', path: '/x' }))).rejects.toBeInstanceOf(cls)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it('gives up after maxRetries and throws the mapped error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { error: 'boom', code: 'internal', meta: null }))
    const client = makeClient(fetchMock)
    await expect(settle(client._request({ method: 'GET', path: '/x' }))).rejects.toBeInstanceOf(InternalServerError)
    expect(fetchMock).toHaveBeenCalledTimes(3) // maxRetries 2 → 3 attempts
  })

  it('maxRetries: 0 disables retries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(429, { error: 'x', code: 'rate_limit_exceeded', meta: { scope: 'developer' } }))
    const client = makeClient(fetchMock)
    await expect(
      settle(client._request({ method: 'GET', path: '/x' }, { maxRetries: 0 }))
    ).rejects.toBeInstanceOf(RateLimitError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries connection errors and maps exhaustion to APIConnectionError', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    const client = makeClient(fetchMock)
    const err = await settle(client._request({ method: 'GET', path: '/x' })).then(
      () => null,
      e => e
    )
    expect(err).toBeInstanceOf(APIConnectionError)
    expect((err as Error).cause).toBeInstanceOf(TypeError)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('recovers when a connection error is followed by success', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    const client = makeClient(fetchMock)
    expect(await settle(client._request({ method: 'GET', path: '/x' }))).toEqual({ ok: true })
  })
})

describe('backoff timing', () => {
  it('honors Retry-After within (0, 60s]', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(429, { error: 'x', code: 'rate_limit_exceeded', meta: { scope: 'developer' } }, { 'retry-after': '2' })
      )
      .mockResolvedValueOnce(jsonResponse(200, {}))
    const client = makeClient(fetchMock)
    const promise = client._request({ method: 'GET', path: '/x' })
    const settled = promise.then(() => fetchMock.mock.calls.length)

    await vi.advanceTimersByTimeAsync(1_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await settled).toBe(2)
  })

  it('ignores Retry-After above 60s in favor of computed backoff', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(429, { error: 'x', code: 'rate_limit_exceeded', meta: { scope: 'developer' } }, { 'retry-after': '120' })
      )
      .mockResolvedValueOnce(jsonResponse(200, {}))
    const client = makeClient(fetchMock)
    const promise = client._request({ method: 'GET', path: '/x' })
    const settled = promise.then(() => fetchMock.mock.calls.length)

    // Computed backoff for attempt 0 with jitter factor 1.0 is exactly 500ms.
    await vi.advanceTimersByTimeAsync(500)
    expect(await settled).toBe(2)
  })

  it('caps computed backoff at 8s', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(500, { error: 'x', code: 'internal', meta: null }))
    const client = makeClient(fetchMock, { maxRetries: 6 })
    const rejected = expect(settle(client._request({ method: 'GET', path: '/x' }))).rejects.toBeInstanceOf(InternalServerError)
    await rejected
    // 7 attempts: 500, 1000, 2000, 4000, 8000, 8000 (capped) sleeps in between.
    expect(fetchMock).toHaveBeenCalledTimes(7)
  })
})

describe('idempotency keys', () => {
  it('auto-generates one key per call and reuses it across retries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { error: 'x', code: 'internal', meta: null }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'job' }))
    const client = makeClient(fetchMock)
    await settle(client._request({ method: 'POST', path: '/v1/simc/jobs', body: {}, idempotent: true }))

    const first = fetchMock.mock.calls[0]![1].headers['idempotency-key']
    const second = fetchMock.mock.calls[1]![1].headers['idempotency-key']
    expect(first).toMatch(/^simmit-node-retry-[0-9a-f-]{36}$/)
    expect(second).toBe(first)
  })

  it('passes a user-supplied key through verbatim', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}))
    const client = makeClient(fetchMock)
    await settle(
      client._request(
        { method: 'POST', path: '/v1/simc/jobs', body: {}, idempotent: true },
        { idempotencyKey: 'my-key' }
      )
    )
    expect(fetchMock.mock.calls[0]![1].headers['idempotency-key']).toBe('my-key')
  })

  it('applies a per-request key over a defaultHeaders idempotency-key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}))
    const client = makeClient(fetchMock, {
      defaultHeaders: { 'idempotency-key': 'constructor-pinned' }
    })
    await settle(
      client._request(
        { method: 'POST', path: '/v1/simc/jobs', body: {}, idempotent: true },
        { idempotencyKey: 'per-call' }
      )
    )
    expect(fetchMock.mock.calls[0]![1].headers['idempotency-key']).toBe('per-call')
  })

  it('lets defaultHeaders override the auto-generated fallback key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}))
    const client = makeClient(fetchMock, {
      defaultHeaders: { 'idempotency-key': 'constructor-pinned' }
    })
    await settle(
      client._request({ method: 'POST', path: '/v1/simc/jobs', body: {}, idempotent: true })
    )
    expect(fetchMock.mock.calls[0]![1].headers['idempotency-key']).toBe('constructor-pinned')
  })

  it('adds no key to plain requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}))
    const client = makeClient(fetchMock)
    await settle(client._request({ method: 'GET', path: '/x' }))
    expect('idempotency-key' in fetchMock.mock.calls[0]![1].headers).toBe(false)
  })
})

describe('timeout and abort', () => {
  function hangingFetch() {
    return vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        })
    )
  }

  it('maps per-attempt timeout exhaustion to APIConnectionTimeoutError', async () => {
    const fetchMock = hangingFetch()
    const client = makeClient(fetchMock, { timeout: 50 })
    await expect(
      settle(client._request({ method: 'GET', path: '/x' }, { maxRetries: 0 }))
    ).rejects.toBeInstanceOf(APIConnectionTimeoutError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries timeouts until exhausted', async () => {
    const fetchMock = hangingFetch()
    const client = makeClient(fetchMock, { timeout: 50, maxRetries: 2 })
    await expect(settle(client._request({ method: 'GET', path: '/x' }))).rejects.toBeInstanceOf(
      APIConnectionTimeoutError
    )
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('maps a user abort to APIUserAbortError and never retries', async () => {
    const fetchMock = hangingFetch()
    const client = makeClient(fetchMock)
    const controller = new AbortController()
    const promise = client._request({ method: 'GET', path: '/x' }, { signal: controller.signal })
    const outcome = promise.then(
      () => null,
      e => e
    )
    controller.abort()
    await vi.runAllTimersAsync()
    expect(await outcome).toBeInstanceOf(APIUserAbortError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('aborts backoff sleeps too', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(500, { error: 'x', code: 'internal', meta: null }))
    const client = makeClient(fetchMock)
    const controller = new AbortController()
    const promise = client._request({ method: 'GET', path: '/x' }, { signal: controller.signal })
    const outcome = promise.then(
      () => null,
      e => e
    )
    // Let the first attempt fail and the backoff sleep start, then abort mid-sleep.
    await vi.advanceTimersByTimeAsync(100)
    controller.abort()
    await vi.runAllTimersAsync()
    expect(await outcome).toBeInstanceOf(APIUserAbortError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('APIPromise rejection handling', () => {
  it('does not leak an unhandled rejection when only withResponse() is consumed', async () => {
    vi.useRealTimers()
    const unhandled: unknown[] = []
    const onUnhandled = (err: unknown) => unhandled.push(err)
    process.on('unhandledRejection', onUnhandled)
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse(400, { error: 'bad', code: 'missing_input', meta: null }))
      const client = makeClient(fetchMock)
      const promise = client._request({ method: 'GET', path: '/x' })
      await expect(promise.withResponse()).rejects.toBeInstanceOf(BadRequestError)
      // Give Node a macrotask boundary to emit unhandledRejection if the
      // APIPromise instance itself rejected without a handler.
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(unhandled).toEqual([])
    } finally {
      process.removeListener('unhandledRejection', onUnhandled)
    }
  })

  it('supports catch/finally chaining through the lazy then()', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { error: 'no', code: 'invalid_token', meta: null }))
    const client = makeClient(fetchMock)
    let ranFinally = false
    const caught = await settle(
      client
        ._request({ method: 'GET', path: '/x' })
        .catch((err: unknown) => err)
        .finally(() => {
          ranFinally = true
        })
    )
    expect(caught).toBeInstanceOf(AuthenticationError)
    expect(ranFinally).toBe(true)
  })
})

describe('body reads inside the per-attempt timeout', () => {
  it('maps a stalled response body to APIConnectionTimeoutError', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = new ReadableStream({
        start(streamController) {
          init.signal?.addEventListener('abort', () =>
            streamController.error(new DOMException('aborted', 'AbortError'))
          )
        }
      })
      return Promise.resolve(
        new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
      )
    })
    const client = makeClient(fetchMock, { timeout: 50 })
    await expect(
      settle(client._request({ method: 'GET', path: '/x' }, { maxRetries: 0 }))
    ).rejects.toBeInstanceOf(APIConnectionTimeoutError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats a malformed 2xx body as a retryable transport failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('not json', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    const client = makeClient(fetchMock)
    expect(await settle(client._request({ method: 'GET', path: '/x' }))).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('maps an exhausted malformed 2xx body to APIConnectionError with the parse cause', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response('not json', { status: 200 }))
    )
    const client = makeClient(fetchMock)
    const err = await settle(client._request({ method: 'GET', path: '/x' })).then(
      () => null,
      (e: unknown) => e
    )
    expect(err).toBeInstanceOf(APIConnectionError)
    expect((err as Error).cause).toBeInstanceOf(SyntaxError)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('maps a non-JSON error body to the status class with no code', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('<html>lb error</html>', { status: 400 }))
    const client = makeClient(fetchMock)
    const err = await settle(client._request({ method: 'GET', path: '/x' })).then(
      () => null,
      (e: unknown) => e
    )
    expect(err).toBeInstanceOf(BadRequestError)
    expect((err as BadRequestError).code).toBeUndefined()
    expect((err as Error).message).toBe('400 status code (no body)')
  })
})
