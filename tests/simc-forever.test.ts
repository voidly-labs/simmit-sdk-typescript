import { afterEach, describe, expect, it, vi } from 'vitest'
import { APIPromise } from '../src/api-promise'
import Simmit from '../src/client'
import type { RequestOptions } from '../src/client'
import type { SimcForeverJobCreateParams } from '../src/api-types'
import { ResultNotReadyError } from '../src/error'
import { isTerminal } from '../src/status'

const params: SimcForeverJobCreateParams = {
  build: { channel: 'latest' },
  profile: { text: '# a tiny profile' }
}

function makeClient() {
  return new Simmit({ secretKey: 'smt_sk_test' })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('simcForever resource → _request wiring', () => {
  function spyRequest(client: Simmit) {
    const sentinel = {} as APIPromise<never>
    const spy = vi.spyOn(client, '_request').mockReturnValue(sentinel)
    return { spy, sentinel }
  }

  it('jobs.create → POST /v1/simc-forever/jobs with body and idempotent:true', () => {
    const client = makeClient()
    const { spy, sentinel } = spyRequest(client)
    const options: RequestOptions = { timeout: 5_000 }

    const out = client.simcForever.jobs.create(params, options)

    expect(spy).toHaveBeenCalledWith(
      {
        method: 'POST',
        path: '/v1/simc-forever/jobs',
        body: params,
        idempotent: true
      },
      options
    )
    expect(out).toBe(sentinel)
  })

  it('jobs.list → GET /v1/simc-forever/jobs with limit and cursor query', () => {
    const client = makeClient()
    const { spy, sentinel } = spyRequest(client)

    const out = client.simcForever.jobs.list({ limit: 50, cursor: 'c1' })

    expect(spy).toHaveBeenCalledWith(
      {
        method: 'GET',
        path: '/v1/simc-forever/jobs',
        query: { limit: 50, cursor: 'c1' }
      },
      undefined
    )
    expect(out).toBe(sentinel)
  })

  it.each([
    ['get', 'GET', ''],
    ['getResult', 'GET', '/result'],
    ['getProfile', 'GET', '/profile'],
    ['cancel', 'POST', '/cancel']
  ] as const)(
    'jobs.%s → %s /v1/simc-forever/jobs/{id}%s',
    (method, verb, suffix) => {
      const client = makeClient()
      const { spy, sentinel } = spyRequest(client)

      const out = client.simcForever.jobs[method]('weird/id?x')

      expect(spy).toHaveBeenCalledWith(
        {
          method: verb,
          path: `/v1/simc-forever/jobs/weird%2Fid%3Fx${suffix}`
        },
        undefined
      )
      expect(out).toBe(sentinel)
    }
  )

  it('jobs.getStatus → GET /v1/simc-forever/jobs/{id}/status, include split from options', () => {
    const client = makeClient()
    const { spy, sentinel } = spyRequest(client)

    const out = client.simcForever.jobs.getStatus('j1', {
      include: ['logEntries'],
      timeout: 5_000
    })

    expect(spy).toHaveBeenCalledWith(
      {
        method: 'GET',
        path: '/v1/simc-forever/jobs/j1/status',
        query: { include: 'logEntries' }
      },
      { timeout: 5_000 }
    )
    expect(out).toBe(sentinel)
  })

  it('profiles.check → POST /v1/simc-forever/profiles/check without an idempotency flag', () => {
    const client = makeClient()
    const { spy, sentinel } = spyRequest(client)
    const body = { profile: { text: '# a tiny profile' } }

    const out = client.simcForever.profiles.check(body)

    expect(spy).toHaveBeenCalledWith(
      { method: 'POST', path: '/v1/simc-forever/profiles/check', body },
      undefined
    )
    expect(out).toBe(sentinel)
  })

  it('artifacts.getUrl → GET /v1/simc-forever/artifacts/{id}/url', () => {
    const client = makeClient()
    const { spy, sentinel } = spyRequest(client)

    const out = client.simcForever.artifacts.getUrl('a/1')

    expect(spy).toHaveBeenCalledWith(
      { method: 'GET', path: '/v1/simc-forever/artifacts/a%2F1/url' },
      undefined
    )
    expect(out).toBe(sentinel)
  })
})

describe('simcForever.jobs (end to end)', () => {
  it('create sends an auto-generated idempotency key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ id: 'j1' }))
    const client = new Simmit({ secretKey: 'smt_sk_test', fetch: fetchMock })

    const created = await client.simcForever.jobs.create(params)

    expect(created.id).toBe('j1')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.simmit.com/v1/simc-forever/jobs')
    expect(JSON.parse(init.body)).toEqual(params)
    expect(init.headers['idempotency-key']).toMatch(/^simmit-node-retry-/)
  })

  it('getStatus feeds isTerminal for a hand-rolled poll loop', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ status: 'running' }))
      .mockResolvedValueOnce(json({ status: 'completed' }))
    const client = new Simmit({ secretKey: 'smt_sk_test', fetch: fetchMock })

    const running = await client.simcForever.jobs.getStatus('j1')
    const done = await client.simcForever.jobs.getStatus('j1')

    expect(isTerminal(running.status)).toBe(false)
    expect(isTerminal(done.status)).toBe(true)
  })

  it('getResult maps the shared error codes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json(
        {
          error: 'Job is not finished',
          code: 'result_not_ready',
          meta: { status: 'running' }
        },
        409
      )
    )
    const client = new Simmit({ secretKey: 'smt_sk_test', fetch: fetchMock })

    await expect(
      client.simcForever.jobs.getResult('j1')
    ).rejects.toBeInstanceOf(ResultNotReadyError)
  })
})
