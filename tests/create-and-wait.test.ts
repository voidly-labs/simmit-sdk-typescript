import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Simmit from '../src/client'
import {
  APIUserAbortError,
  JobCancelledError,
  JobFailedError,
  JobTimedOutError,
  JobWaitTimeoutError
} from '../src/error'
import {
  deriveWaitTimeoutMs,
  isTerminal,
  MAX_POLL_INTERVAL_MS,
  nextPollInterval
} from '../src/internal/poll'
import type {
  JobCreateParams,
  JobCreateResponse,
  JobStatus,
  JobStatusResponse
} from '../src/api-types'

const params = {
  build: { channel: 'latest' },
  profile: { text: '# a tiny profile' }
} as JobCreateParams

const CREATE = {
  success: true,
  id: 'job_123',
  runtime: { ceiling: { runtimeSeconds: 300, queueSeconds: 1800 } },
  links: { share: 'https://simmit.com/jobs/job_123' }
}

function jobRecord(status: JobStatus) {
  return {
    id: 'job_123',
    status,
    statusReason: status === 'completed' ? null : 'detail',
    errorCode: status === 'failed' ? 'simulation_error' : null
  }
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

/**
 * fetch mock that routes by method/path: POST /jobs → create, GET …/status →
 * next entry of `statuses` (last repeats), POST …/cancel → cancel envelope,
 * GET …/{id} → the full record.
 */
function makeFetch(statuses: JobStatus[], record: object, create = CREATE) {
  let i = 0
  return vi.fn().mockImplementation((url: string, init: RequestInit) => {
    const method = init.method
    if (method === 'POST' && url.endsWith('/v1/simc/jobs')) {
      return Promise.resolve(json(create))
    }
    if (method === 'GET' && url.includes('/status')) {
      const status = statuses[Math.min(i, statuses.length - 1)]
      i++
      return Promise.resolve(json({ status }))
    }
    if (method === 'POST' && url.endsWith('/cancel')) {
      return Promise.resolve(
        json({ success: true, id: 'job_123', status: 'cancel_requested' })
      )
    }
    if (method === 'GET') return Promise.resolve(json(record))
    return Promise.reject(new Error(`unexpected ${method} ${url}`))
  })
}

function makeClient(fetchMock: typeof globalThis.fetch) {
  return new Simmit({ secretKey: 'smt_sk_test', fetch: fetchMock })
}

function statusPollCount(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    ([url, init]) => init.method === 'GET' && url.includes('/status')
  ).length
}

function didCancel(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.some(
    ([url, init]) => init.method === 'POST' && url.endsWith('/cancel')
  )
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Runs the wait to completion, draining poll-interval sleeps. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  const guarded = promise.catch((err) => ({ __err: err }) as const)
  await vi.runAllTimersAsync()
  const result = await guarded
  if (result && typeof result === 'object' && '__err' in (result as object)) {
    throw (result as { __err: unknown }).__err
  }
  return result as T
}

describe('poll helpers', () => {
  it('grows the interval ×1.5, capped at 10s', () => {
    expect(nextPollInterval(1_000)).toBe(1_500)
    expect(nextPollInterval(1_500)).toBe(2_250)
    expect(nextPollInterval(8_000)).toBe(MAX_POLL_INTERVAL_MS) // 12s → capped
    expect(nextPollInterval(10_000)).toBe(MAX_POLL_INTERVAL_MS)
  })

  it('recognizes the four terminal states', () => {
    const terminal: JobStatus[] = [
      'completed',
      'failed',
      'cancelled',
      'timed_out'
    ]
    const live: JobStatus[] = ['pending', 'queued', 'starting', 'running']
    expect(terminal.every(isTerminal)).toBe(true)
    expect(live.some(isTerminal)).toBe(false)
  })

  it('derives the deadline from ceilings plus a 60s grace', () => {
    const created = {
      runtime: { ceiling: { runtimeSeconds: 300, queueSeconds: 1800 } }
    } as JobCreateResponse
    expect(deriveWaitTimeoutMs(created)).toBe((300 + 1800) * 1_000 + 60_000)
  })

  it('falls back to 45 minutes when a ceiling is null', () => {
    const nullRuntime = {
      runtime: { ceiling: { runtimeSeconds: null, queueSeconds: 1800 } }
    } as JobCreateResponse
    const nullQueue = {
      runtime: { ceiling: { runtimeSeconds: 300, queueSeconds: null } }
    } as JobCreateResponse
    expect(deriveWaitTimeoutMs(nullRuntime)).toBe(45 * 60 * 1_000)
    expect(deriveWaitTimeoutMs(nullQueue)).toBe(45 * 60 * 1_000)
  })
})

describe('createAndWait success path', () => {
  it('resolves with the completed job after polling to terminal', async () => {
    const fetchMock = makeFetch(
      ['queued', 'running', 'completed'],
      jobRecord('completed')
    )
    const client = makeClient(fetchMock)

    const job = await settle(client.jobs.createAndWait(params))

    expect(job.status).toBe('completed')
    expect(job.id).toBe('job_123')
    expect(statusPollCount(fetchMock)).toBe(3)
    // create + 3 status polls + 1 full-record get; no cancel.
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(didCancel(fetchMock)).toBe(false)
  })

  it('fires onCreated before polling and onPoll per poll', async () => {
    const fetchMock = makeFetch(
      ['running', 'completed'],
      jobRecord('completed')
    )
    const client = makeClient(fetchMock)
    let callsWhenCreated = -1
    const onCreated = vi.fn((_response: JobCreateResponse) => {
      callsWhenCreated = fetchMock.mock.calls.length
    })
    const onPoll = vi.fn((_status: JobStatusResponse) => {})

    await settle(client.jobs.createAndWait(params, { onCreated, onPoll }))

    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(onCreated.mock.calls[0]![0].id).toBe('job_123')
    expect(callsWhenCreated).toBe(1) // only the create request had fired
    expect(onPoll.mock.calls.map((c) => c[0].status)).toEqual([
      'running',
      'completed'
    ])
  })
})

describe('createAndWait terminal failures', () => {
  it.each([
    ['failed', JobFailedError],
    ['cancelled', JobCancelledError],
    ['timed_out', JobTimedOutError]
  ] as const)(
    'throws on %s with the full job attached',
    async (status, Err) => {
      const fetchMock = makeFetch([status], jobRecord(status))
      const client = makeClient(fetchMock)

      const err = await settle(client.jobs.createAndWait(params)).then(
        () => null,
        (e: unknown) => e
      )

      expect(err).toBeInstanceOf(Err)
      expect((err as InstanceType<typeof Err>).job.id).toBe('job_123')
      expect((err as InstanceType<typeof Err>).job.status).toBe(status)
      expect(didCancel(fetchMock)).toBe(false) // never auto-cancels
    }
  )
})

describe('createAndWait deadlines and abort', () => {
  it('throws JobWaitTimeoutError and leaves the job running', async () => {
    const fetchMock = makeFetch(['running'], jobRecord('running'))
    const client = makeClient(fetchMock)

    const err = await settle(
      client.jobs.createAndWait(params, { waitTimeoutMs: 5_000 })
    ).then(
      () => null,
      (e: unknown) => e
    )

    expect(err).toBeInstanceOf(JobWaitTimeoutError)
    expect((err as JobWaitTimeoutError).jobId).toBe('job_123')
    expect((err as JobWaitTimeoutError).lastStatus).toBe('running')
    expect(didCancel(fetchMock)).toBe(false)
    // Never reached terminal, so the full record was never fetched.
    const fullGets = fetchMock.mock.calls.filter(
      ([url, init]) => init.method === 'GET' && !url.includes('/status')
    )
    expect(fullGets).toHaveLength(0)
  })

  it('uses the derived deadline, not the 45-minute fallback', async () => {
    // ceilings 0/0 → derived deadline is the 60s grace alone.
    const fetchMock = makeFetch(['running'], jobRecord('running'), {
      ...CREATE,
      runtime: { ceiling: { runtimeSeconds: 0, queueSeconds: 0 } }
    })
    const client = makeClient(fetchMock)
    let err: unknown
    let done = false
    const p = client.jobs
      .createAndWait(params)
      .then(
        () => {},
        (e: unknown) => {
          err = e
        }
      )
      .finally(() => {
        done = true
      })

    await vi.advanceTimersByTimeAsync(59_000)
    expect(done).toBe(false) // still polling before the 60s deadline
    await vi.advanceTimersByTimeAsync(2_000)
    await p
    expect(done).toBe(true) // and not still waiting at 45min → derived path used
    expect(err).toBeInstanceOf(JobWaitTimeoutError)
  })

  it('aborts mid-wait with APIUserAbortError and no cancel', async () => {
    const controller = new AbortController()
    const fetchMock = makeFetch(['running'], jobRecord('running'))
    const client = makeClient(fetchMock)

    const outcome = client.jobs
      .createAndWait(params, { signal: controller.signal })
      .then(
        () => null,
        (e: unknown) => e
      )
    await vi.advanceTimersByTimeAsync(1_000) // create + first poll, into next sleep
    controller.abort()
    await vi.runAllTimersAsync()

    expect(await outcome).toBeInstanceOf(APIUserAbortError)
    expect(didCancel(fetchMock)).toBe(false)
  })
})

describe('createAndWait poll cadence', () => {
  it('polls after 1s, then +1.5s, then +2.25s', async () => {
    const fetchMock = makeFetch(
      ['running', 'running', 'running', 'completed'],
      jobRecord('completed')
    )
    const client = makeClient(fetchMock)
    const guarded = client.jobs.createAndWait(params).then(
      () => {},
      () => {}
    )

    await vi.advanceTimersByTimeAsync(999)
    expect(statusPollCount(fetchMock)).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(statusPollCount(fetchMock)).toBe(1) // t=1000
    await vi.advanceTimersByTimeAsync(1_499)
    expect(statusPollCount(fetchMock)).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(statusPollCount(fetchMock)).toBe(2) // t=2500
    await vi.advanceTimersByTimeAsync(2_249)
    expect(statusPollCount(fetchMock)).toBe(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(statusPollCount(fetchMock)).toBe(3) // t=4750

    await vi.runAllTimersAsync()
    await guarded
  })
})
