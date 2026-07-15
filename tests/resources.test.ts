import { afterEach, describe, expect, it, vi } from 'vitest'
import { APIPromise } from '../src/api-promise'
import Simmit from '../src/client'
import type { RequestOptions } from '../src/client'
import type { JobCreateParams } from '../src/api-types'

const params: JobCreateParams = {
  build: { channel: 'latest' },
  profile: { text: '# a tiny profile' }
}

function makeClient() {
  return new Simmit({ secretKey: 'smt_sk_test' })
}

afterEach(() => {
  vi.restoreAllMocks()
})

// Resources are thin wrappers: each must hand `_request` the exact spec the
// spec/DESIGN §4 prescribes, forward `options` untouched, and return the
// APIPromise verbatim. Mocking `_request` isolates that contract from the
// request layer (covered in request.test.ts).
describe('resource → _request wiring', () => {
  /** Spy on `_request` and return a sentinel so we can assert pass-through. */
  function spyRequest(client: Simmit) {
    const sentinel = {} as APIPromise<never>
    const spy = vi.spyOn(client, '_request').mockReturnValue(sentinel)
    return { spy, sentinel }
  }

  it('jobs.create → POST /v1/simc/jobs with body and idempotent:true', () => {
    const client = makeClient()
    const { spy, sentinel } = spyRequest(client)
    const options: RequestOptions = { timeout: 5_000 }

    const out = client.jobs.create(params, options)

    expect(spy).toHaveBeenCalledWith(
      { method: 'POST', path: '/v1/simc/jobs', body: params, idempotent: true },
      options
    )
    expect(out).toBe(sentinel)
  })

  it('jobs.get → GET /v1/simc/jobs/{id}', () => {
    const client = makeClient()
    const { spy, sentinel } = spyRequest(client)

    const out = client.jobs.get('519253542012420096')

    expect(spy).toHaveBeenCalledWith(
      { method: 'GET', path: '/v1/simc/jobs/519253542012420096' },
      undefined
    )
    expect(out).toBe(sentinel)
  })

  it('jobs.getStatus → GET /v1/simc/jobs/{id}/status', () => {
    const client = makeClient()
    const { spy, sentinel } = spyRequest(client)

    const out = client.jobs.getStatus('519253542012420096')

    expect(spy).toHaveBeenCalledWith(
      { method: 'GET', path: '/v1/simc/jobs/519253542012420096/status' },
      undefined
    )
    expect(out).toBe(sentinel)
  })

  it('jobs.getResult → GET /v1/simc/jobs/{id}/result', () => {
    const client = makeClient()
    const { spy, sentinel } = spyRequest(client)

    const out = client.jobs.getResult('519253542012420096', { maxRetries: 0 })

    expect(spy).toHaveBeenCalledWith(
      { method: 'GET', path: '/v1/simc/jobs/519253542012420096/result' },
      { maxRetries: 0 }
    )
    expect(out).toBe(sentinel)
  })

  it('jobs.getProfile → GET /v1/simc/jobs/{id}/profile', () => {
    const client = makeClient()
    const { spy, sentinel } = spyRequest(client)

    const out = client.jobs.getProfile('519253542012420096')

    expect(spy).toHaveBeenCalledWith(
      { method: 'GET', path: '/v1/simc/jobs/519253542012420096/profile' },
      undefined
    )
    expect(out).toBe(sentinel)
  })

  it('jobs.cancel → POST /v1/simc/jobs/{id}/cancel with no idempotency flag', () => {
    const client = makeClient()
    const { spy, sentinel } = spyRequest(client)

    const out = client.jobs.cancel('519253542012420096')

    expect(spy).toHaveBeenCalledWith(
      { method: 'POST', path: '/v1/simc/jobs/519253542012420096/cancel' },
      undefined
    )
    expect(out).toBe(sentinel)
  })

  it('credits.get → GET /v1/simc/credits', () => {
    const client = makeClient()
    const { spy, sentinel } = spyRequest(client)

    const out = client.credits.get()

    expect(spy).toHaveBeenCalledWith(
      { method: 'GET', path: '/v1/simc/credits' },
      undefined
    )
    expect(out).toBe(sentinel)
  })

  it('artifacts.getUrl → GET /v1/simc/artifacts/{id}/url', () => {
    const client = makeClient()
    const { spy, sentinel } = spyRequest(client)

    const out = client.artifacts.getUrl('art_123')

    expect(spy).toHaveBeenCalledWith(
      { method: 'GET', path: '/v1/simc/artifacts/art_123/url' },
      undefined
    )
    expect(out).toBe(sentinel)
  })

  it('usage.get → GET /v1/simc/usage', () => {
    const client = makeClient()
    const { spy, sentinel } = spyRequest(client)

    const out = client.usage.get()

    expect(spy).toHaveBeenCalledWith(
      { method: 'GET', path: '/v1/simc/usage' },
      undefined
    )
    expect(out).toBe(sentinel)
  })

  it('encodes the job id into the path', () => {
    const client = makeClient()
    const { spy } = spyRequest(client)

    client.jobs.get('weird/id?x')

    expect(spy.mock.calls[0]![0].path).toBe('/v1/simc/jobs/weird%2Fid%3Fx')
  })
})

describe('jobs.getStatus (end to end)', () => {
  it('returns live status for a non-terminal job without throwing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ status: 'running', progress: { percent: 42 } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    const client = new Simmit({ secretKey: 'smt_sk_test', fetch: fetchMock })

    const status = await client.jobs.getStatus('519253542012420096')

    expect(status.status).toBe('running')
    expect(status.progress.percent).toBe(42)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(
      'https://api.simmit.com/v1/simc/jobs/519253542012420096/status'
    )
    expect(init.method).toBe('GET')
  })
})

describe('usage.get (end to end)', () => {
  it('returns the account limits and in-flight snapshot', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          period: {
            avgRuntimeSeconds: 12,
            readsUsed: 3,
            readsLimit: null,
            readsCapResetAt: null
          },
          snapshot: { activeJobs: 2, queuedJobs: 1, runningJobs: 1 },
          limits: { maxActiveJobs: 5 }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    const client = new Simmit({ secretKey: 'smt_sk_test', fetch: fetchMock })

    const usage = await client.usage.get()

    expect(usage.limits.maxActiveJobs).toBe(5)
    expect(usage.snapshot.activeJobs).toBe(2)
    expect(usage.period.avgRuntimeSeconds).toBe(12)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.simmit.com/v1/simc/usage')
    expect(init.method).toBe('GET')
  })
})

// Beyond the wiring contract: prove `idempotent: true` actually puts a key on
// the wire when create runs through the real request layer.
describe('jobs.create idempotency key (end to end)', () => {
  it('emits an auto-generated idempotency-key header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, id: 'job_1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    const client = new Simmit({ secretKey: 'smt_sk_test', fetch: fetchMock })

    await client.jobs.create(params)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.simmit.com/v1/simc/jobs')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual(params)
    expect(init.headers['idempotency-key']).toMatch(
      /^simmit-node-retry-[0-9a-f-]{36}$/
    )
  })

  it('forwards a caller-supplied idempotencyKey verbatim', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, id: 'job_1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    const client = new Simmit({ secretKey: 'smt_sk_test', fetch: fetchMock })

    await client.jobs.create(params, { idempotencyKey: 'caller-key' })

    expect(fetchMock.mock.calls[0]![1].headers['idempotency-key']).toBe(
      'caller-key'
    )
  })
})
