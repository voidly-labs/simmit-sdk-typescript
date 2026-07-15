import { describe, expect, it } from 'vitest'
import type { Job } from '../src/api-types'
import {
  APIConnectionError,
  APIError,
  AuthenticationError,
  BadRequestError,
  BillingError,
  ConflictError,
  IdempotencyKeyReuseError,
  InsufficientCreditsError,
  InsufficientCreditsLiabilityError,
  InternalServerError,
  InvalidProfileError,
  JobCancelledError,
  JobFailedError,
  JobNotCancellableError,
  JobUnsuccessfulError,
  JobWaitTimeoutError,
  MaxActiveJobsError,
  NotFoundError,
  RateLimitError,
  RequestTooLargeError,
  ResultNotReadyError,
  ResultUnavailableError,
  ServiceUnavailableError,
  SimmitError,
  TooManyVariantsError,
  UnprocessableEntityError,
  WebhookVerificationError
} from '../src/error'

const headers = new Headers()

function generate(status: number, body: object | undefined) {
  return APIError.generate(status, body, undefined, headers)
}

function envelope(code: string, meta: object | null = null) {
  return { error: `human message for ${code}`, code, meta }
}

describe('APIError.generate status → class mapping', () => {
  it.each([
    [400, envelope('missing_input'), BadRequestError],
    [401, envelope('invalid_token'), AuthenticationError],
    [404, envelope('job_not_found'), NotFoundError],
    [413, envelope('profile_too_large'), RequestTooLargeError],
    [500, envelope('internal'), InternalServerError],
    [502, {}, InternalServerError]
  ] as const)('%i → %o', (status, body, cls) => {
    const err = generate(status, body)
    expect(err).toBeInstanceOf(cls)
    expect(err.status).toBe(status)
  })

  it('maps unmapped 4xx to base APIError', () => {
    const err = generate(418, envelope('teapot'))
    expect(err.constructor).toBe(APIError)
  })

  it('maps missing status/headers to APIConnectionError', () => {
    const err = APIError.generate(undefined, undefined, 'boom', undefined)
    expect(err).toBeInstanceOf(APIConnectionError)
    expect(err.status).toBeUndefined()
    expect(err.message).toBe('boom')
  })
})

describe('code subclass selection', () => {
  it.each([
    [402, 'insufficient_credits', InsufficientCreditsError, BillingError],
    [
      402,
      'insufficient_credits_liability',
      InsufficientCreditsLiabilityError,
      BillingError
    ],
    [409, 'idempotency_key_reuse', IdempotencyKeyReuseError, ConflictError],
    [409, 'result_not_ready', ResultNotReadyError, ConflictError],
    [409, 'job_not_cancellable', JobNotCancellableError, ConflictError],
    [
      422,
      'input_sanitized_rejected',
      InvalidProfileError,
      UnprocessableEntityError
    ],
    [
      422,
      'result_unavailable',
      ResultUnavailableError,
      UnprocessableEntityError
    ],
    [422, 'too_many_variants', TooManyVariantsError, UnprocessableEntityError],
    [429, 'max_active_jobs_exceeded', MaxActiveJobsError, RateLimitError],
    [429, 'rate_limit_exceeded', RateLimitError, APIError]
  ] as const)('%i %s', (status, code, cls, parent) => {
    const err = generate(status, envelope(code))
    expect(err).toBeInstanceOf(cls)
    expect(err).toBeInstanceOf(parent)
    expect(err).toBeInstanceOf(SimmitError)
    expect(err.code).toBe(code)
  })

  it('degrades unknown codes to the status class instead of breaking instanceof', () => {
    expect(generate(402, envelope('account_suspended')).constructor).toBe(
      BillingError
    )
    expect(generate(409, envelope('some_new_conflict')).constructor).toBe(
      ConflictError
    )
    expect(generate(422, envelope('some_new_rejection')).constructor).toBe(
      UnprocessableEntityError
    )
  })
})

describe('typed meta', () => {
  it('surfaces maxAffordableRuntimeSeconds on InsufficientCreditsError', () => {
    const err = generate(
      402,
      envelope('insufficient_credits', {
        reason: 'insufficient_credits',
        maxAffordableRuntimeSeconds: 120
      })
    ) as InsufficientCreditsError
    expect(err.meta?.maxAffordableRuntimeSeconds).toBe(120)
  })

  it('surfaces priorityFeeCredits on InsufficientCreditsLiabilityError', () => {
    const err = generate(
      402,
      envelope('insufficient_credits_liability', {
        reason: 'insufficient_credits_liability',
        priorityFeeCredits: 50
      })
    ) as InsufficientCreditsLiabilityError
    expect(err.meta?.priorityFeeCredits).toBe(50)
  })

  it('surfaces variant counts on TooManyVariantsError', () => {
    const err = generate(
      422,
      envelope('too_many_variants', {
        reason: 'too_many_variants',
        totalVariants: 5000,
        maxVariants: 1000,
        upgradeUrl: 'https://simmit.com/account'
      })
    ) as TooManyVariantsError
    expect(err.meta.totalVariants).toBe(5000)
    expect(err.meta.maxVariants).toBe(1000)
    expect(err.meta.upgradeUrl).toBe('https://simmit.com/account')
  })

  it('preserves null meta and exposes the raw body via .error', () => {
    const body = envelope('missing_token')
    const err = generate(401, body)
    expect(err.meta).toBeNull()
    expect(err.error).toBe(body)
  })
})

describe('requestId', () => {
  it('reads the X-Request-Id response header', () => {
    const h = new Headers({ 'x-request-id': 'req_header' })
    const err = APIError.generate(500, envelope('internal'), undefined, h)
    expect(err.requestId).toBe('req_header')
  })

  it('falls back to the body requestId when the header is absent', () => {
    const err = generate(500, {
      ...envelope('internal'),
      requestId: 'req_body'
    })
    expect(err.requestId).toBe('req_body')
  })

  it('prefers the header over the body requestId', () => {
    const h = new Headers({ 'x-request-id': 'req_header' })
    const err = APIError.generate(
      500,
      { ...envelope('internal'), requestId: 'req_body' },
      undefined,
      h
    )
    expect(err.requestId).toBe('req_header')
  })

  it('is undefined when neither header nor body carries it', () => {
    expect(generate(500, envelope('internal')).requestId).toBeUndefined()
  })
})

describe('503 handling', () => {
  it('returns ServiceUnavailableError with a narrowable body for enumerated codes', () => {
    const err = generate(
      503,
      envelope('api_maintenance', { retryAfterSeconds: 600 })
    )
    expect(err).toBeInstanceOf(ServiceUnavailableError)
    expect(err).toBeInstanceOf(InternalServerError)
    const sue = err as ServiceUnavailableError
    if (sue.body.code === 'api_maintenance') {
      expect(sue.body.meta.retryAfterSeconds).toBe(600)
    } else {
      expect.unreachable('expected api_maintenance body')
    }
  })

  it('falls back to InternalServerError when the 503 body is not the enumerated envelope', () => {
    expect(generate(503, undefined).constructor).toBe(InternalServerError)
    expect(generate(503, { note: 'lb html page' }).constructor).toBe(
      InternalServerError
    )
  })
})

describe('message formatting', () => {
  it("uses the envelope's error string with the status prefix", () => {
    const err = generate(401, envelope('invalid_token'))
    expect(err.message).toBe('401 human message for invalid_token')
  })

  it('stringifies bodies without an error string', () => {
    const err = generate(500, { code: 'weird' })
    expect(err.message).toBe('500 {"code":"weird"}')
  })

  it('notes a missing body', () => {
    expect(generate(500, undefined).message).toBe('500 status code (no body)')
  })
})

describe('job-level errors', () => {
  const job = {
    id: '519253542012420096',
    status: 'failed',
    priority: 'standard',
    createdAt: '2026-06-11T00:00:00.000Z',
    startedAt: '2026-06-11T00:00:05.000Z',
    completedAt: '2026-06-11T00:01:00.000Z',
    cancelRequestedAt: null,
    errorCode: 'simulation_error',
    statusReason: 'SimC exited non-zero',
    simcExitCode: '1',
    retentionDays: 30,
    metadata: null,
    runtime: {
      simDurationMs: 1000,
      totalDurationMs: 2000,
      creditsConsumed: 1,
      priorityFeeCredits: 0,
      vcpus: 4,
      ceiling: { runtimeSeconds: 300, queueSeconds: 1800 }
    },
    retried: false,
    build: null,
    links: { share: 'https://simmit.com/jobs/519253542012420096' }
  } as Job

  it('carries the full job and a readable message', () => {
    const err = new JobFailedError(job)
    expect(err).toBeInstanceOf(JobUnsuccessfulError)
    expect(err).toBeInstanceOf(SimmitError)
    expect(err.job).toBe(job)
    expect(err.message).toBe(
      'Job 519253542012420096 failed: SimC exited non-zero (simulation_error)'
    )
  })

  it('JobCancelledError shares the catch-all base', () => {
    const err = new JobCancelledError({ ...job, status: 'cancelled' } as Job)
    expect(err).toBeInstanceOf(JobUnsuccessfulError)
  })

  it('JobWaitTimeoutError carries jobId and lastStatus but no job', () => {
    const err = new JobWaitTimeoutError({
      jobId: job.id,
      lastStatus: 'running'
    })
    expect(err).toBeInstanceOf(SimmitError)
    expect(err).not.toBeInstanceOf(JobUnsuccessfulError)
    expect(err.jobId).toBe(job.id)
    expect(err.lastStatus).toBe('running')
    expect(err.message).toContain('continues to bill')
  })
})

describe('webhook verification error', () => {
  it('is a SimmitError but not an APIError', () => {
    const err = new WebhookVerificationError('bad signature')
    expect(err).toBeInstanceOf(SimmitError)
    expect(err).not.toBeInstanceOf(APIError)
  })
})
