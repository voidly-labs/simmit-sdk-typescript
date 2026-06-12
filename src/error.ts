import type { Job, JobStatus } from './api-types'

export class SimmitError extends Error {}

/**
 * Value shapes the API's generic error `meta` bag can carry
 * (400/401/404/410/413 responses): JSON scalars, scalar arrays, or arrays of
 * flat objects.
 */
export type MetaValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean>
  | Array<Record<string, string | number | boolean | null>>

export type GenericMeta = Record<string, MetaValue>

/** The API's uniform error envelope: `{ error, code, meta }`. */
interface ErrorEnvelope {
  error?: unknown
  code?: unknown
  meta?: unknown
}

export class APIError<
  TStatus extends number | undefined = number | undefined,
  TCode extends string | undefined = string | undefined,
  TMeta = GenericMeta | null
> extends SimmitError {
  /** HTTP status of the response that caused the error. */
  readonly status: TStatus
  /** HTTP headers of the response that caused the error. */
  readonly headers: Headers | undefined
  /** Machine-readable `code` from the error envelope. */
  readonly code: TCode
  /** Typed `meta` from the error envelope. */
  readonly meta: TMeta
  /** Raw parsed JSON error body — escape hatch for unmapped fields. */
  readonly error: object | undefined

  constructor(
    status: TStatus,
    body: object | undefined,
    message: string | undefined,
    headers: Headers | undefined
  ) {
    super(APIError.makeMessage(status, body, message))
    this.status = status
    this.headers = headers
    this.error = body
    const envelope = body as ErrorEnvelope | undefined
    this.code = (
      typeof envelope?.code === 'string' ? envelope.code : undefined
    ) as TCode
    this.meta = (body ? (envelope?.meta ?? null) : undefined) as TMeta
  }

  private static makeMessage(
    status: number | undefined,
    body: object | undefined,
    message: string | undefined
  ): string {
    // The API's human-readable message field is named `error` (DESIGN §8.3).
    const bodyMessage = (body as ErrorEnvelope | undefined)?.error
    const msg =
      typeof bodyMessage === 'string'
        ? bodyMessage
        : body
          ? JSON.stringify(body)
          : message

    if (status && msg) return `${status} ${msg}`
    if (status) return `${status} status code (no body)`
    if (msg) return msg
    return '(no status code or body)'
  }

  /**
   * Maps a response to the most specific error class: status selects the base
   * class; an enumerated `code` with structured `meta` selects the subclass;
   * anything unrecognized falls back to the status class so new server codes
   * degrade gracefully without breaking `instanceof` handling.
   */
  static generate(
    status: number | undefined,
    body: object | undefined,
    message: string | undefined,
    headers: Headers | undefined
  ): APIError<
    number | undefined,
    string | undefined,
    GenericMeta | null | undefined
  > {
    if (!status || !headers) {
      return new APIConnectionError({
        message,
        cause: body instanceof Error ? body : undefined
      })
    }

    const code = (body as ErrorEnvelope | undefined)?.code

    if (status === 400) return new BadRequestError(400, body, message, headers)
    if (status === 401) {
      return new AuthenticationError(401, body, message, headers)
    }
    if (status === 402) {
      if (code === 'insufficient_credits') {
        return new InsufficientCreditsError(402, body, message, headers)
      }
      if (code === 'insufficient_credits_liability') {
        return new InsufficientCreditsLiabilityError(
          402,
          body,
          message,
          headers
        )
      }
      return new BillingError(402, body, message, headers)
    }
    if (status === 404) return new NotFoundError(404, body, message, headers)
    if (status === 409) {
      if (code === 'idempotency_key_reuse') {
        return new IdempotencyKeyReuseError(409, body, message, headers)
      }
      if (code === 'result_not_ready') {
        return new ResultNotReadyError(409, body, message, headers)
      }
      if (code === 'job_not_cancellable') {
        return new JobNotCancellableError(409, body, message, headers)
      }
      return new ConflictError(409, body, message, headers)
    }
    if (status === 413) {
      return new RequestTooLargeError(413, body, message, headers)
    }
    if (status === 422) {
      if (code === 'input_sanitized_rejected') {
        return new InvalidProfileError(422, body, message, headers)
      }
      if (code === 'result_unavailable') {
        return new ResultUnavailableError(422, body, message, headers)
      }
      return new UnprocessableEntityError(422, body, message, headers)
    }
    if (status === 429) {
      if (code === 'max_active_jobs_exceeded') {
        return new MaxActiveJobsError(429, body, message, headers)
      }
      return new RateLimitError(429, body, message, headers)
    }
    if (status === 503 && isServiceUnavailableBody(body)) {
      return new ServiceUnavailableError(503, body, message, headers)
    }
    if (status >= 500) {
      return new InternalServerError(status, body, message, headers)
    }
    return new APIError(status, body, message, headers)
  }
}

// ── 4xx status classes (code subclasses where the spec enumerates) ──────────

export class BadRequestError extends APIError<400, string> {}

export type AuthenticationErrorCode =
  | 'missing_token'
  | 'invalid_token'
  | 'revoked_token'
  | 'expired_token'

export class AuthenticationError extends APIError<
  401,
  AuthenticationErrorCode
> {}

// 402 codes are docs-enumerated; the spec leaves `code` un-enumerated
// (DESIGN §8.11), so the base class keeps `string` for forward compatibility.
export class BillingError extends APIError<402, string> {}

export type InsufficientCreditsMeta = {
  reason: string
  ceilingRuntimeSeconds?: number
  /** Largest maxRuntimeSeconds the current balance can cover. */
  maxAffordableRuntimeSeconds?: number
  docsUrl?: string
}

export class InsufficientCreditsError extends BillingError {
  declare readonly code: 'insufficient_credits'
  declare readonly meta: InsufficientCreditsMeta | null
}

export type InsufficientCreditsLiabilityMeta = {
  reason: string
  /** The high-priority fee in effect — top up, or resubmit at priority 'standard'. */
  priorityFeeCredits: number
  docsUrl?: string
}

export class InsufficientCreditsLiabilityError extends BillingError {
  declare readonly code: 'insufficient_credits_liability'
  declare readonly meta: InsufficientCreditsLiabilityMeta | null
}

export class NotFoundError extends APIError<404, string> {}

export class ConflictError extends APIError<409, string> {}

export class IdempotencyKeyReuseError extends ConflictError {
  declare readonly code: 'idempotency_key_reuse'
  declare readonly meta: {
    reason: 'idempotency_key_reuse'
    /** ID of the job that originally consumed this idempotency key. */
    originalJobId: string
    docsUrl?: string
  }
}

export class ResultNotReadyError extends ConflictError {
  declare readonly code: 'result_not_ready'
  declare readonly meta: {
    status: 'pending' | 'queued' | 'starting' | 'running'
  }
}

export class JobNotCancellableError extends ConflictError {
  declare readonly code: 'job_not_cancellable'
  declare readonly meta: { id: string; status: JobStatus }
}

export class RequestTooLargeError extends APIError<413, string> {}

export class UnprocessableEntityError extends APIError<422, string> {}

export class InvalidProfileError extends UnprocessableEntityError {
  declare readonly code: 'input_sanitized_rejected'
  declare readonly meta: {
    reason: 'input_sanitized_rejected'
    message: string
    docsUrl: string
    /** Sample of rejected lines; see blockedCount/blockedTruncated for the full set. */
    blocked: Array<{ line: number; text: string }>
    blockedCount: number
    blockedTruncated: boolean
  }
}

export class ResultUnavailableError extends UnprocessableEntityError {
  declare readonly code: 'result_unavailable'
  declare readonly meta: {
    status: 'completed' | 'failed' | 'cancelled' | 'timed_out'
  }
}

export type RateLimitErrorCode =
  | 'rate_limit_exceeded'
  | 'max_active_jobs_exceeded'

export class RateLimitError extends APIError<429, RateLimitErrorCode> {
  declare readonly meta:
    | { scope: 'developer' }
    | {
        reason: 'max_active_jobs_exceeded'
        maxActiveJobs: number
        activeJobs: number
      }
    | null
}

export class MaxActiveJobsError extends RateLimitError {
  declare readonly code: 'max_active_jobs_exceeded'
  declare readonly meta: {
    reason: 'max_active_jobs_exceeded'
    /** Maximum number of jobs the account can have in flight. */
    maxActiveJobs: number
    /** Jobs in flight when this request was rejected. */
    activeJobs: number
  }
}

// ── 5xx ─────────────────────────────────────────────────────────────────────

export class InternalServerError extends APIError<number, string> {}

/**
 * 503 carries four enumerated codes with distinct meta — a discriminated
 * union, narrowed via `.body`. `api_maintenance` gets no special retry
 * behavior (DESIGN §6): standard policy applies, and the typed
 * `meta.retryAfterSeconds` is surfaced so callers can schedule their own
 * resubmission.
 */
export type ServiceUnavailableBody =
  | {
      code: 'queue_unavailable'
      meta: { reason: 'queue_unavailable'; queueHealth: string }
    }
  | {
      code: 'queue_health_unknown'
      meta: { reason: 'queue_health_unknown'; laneId: string }
    }
  | {
      code: 'secret_store_unavailable'
      meta: { reason: 'secret_store_unavailable' }
    }
  | { code: 'api_maintenance'; meta: { retryAfterSeconds: number } }

const SERVICE_UNAVAILABLE_CODES = new Set([
  'queue_unavailable',
  'queue_health_unknown',
  'secret_store_unavailable',
  'api_maintenance'
])

// A 503 whose body isn't the enumerated envelope (e.g. load-balancer HTML)
// falls back to InternalServerError so `.body` below never lies.
function isServiceUnavailableBody(
  body: object | undefined
): body is ServiceUnavailableBody {
  const code = (body as ErrorEnvelope | undefined)?.code
  return typeof code === 'string' && SERVICE_UNAVAILABLE_CODES.has(code)
}

export class ServiceUnavailableError extends InternalServerError {
  declare readonly status: 503

  /** The discriminated 503 envelope: `if (e.body.code === 'api_maintenance') e.body.meta.retryAfterSeconds`. */
  get body(): ServiceUnavailableBody {
    return this.error as ServiceUnavailableBody
  }
}

// ── No HTTP response ────────────────────────────────────────────────────────

export class APIConnectionError extends APIError<
  undefined,
  undefined,
  undefined
> {
  constructor({
    message,
    cause
  }: { message?: string | undefined; cause?: Error | undefined } = {}) {
    super(undefined, undefined, message ?? 'Connection error.', undefined)
    if (cause) this.cause = cause
  }
}

export class APIConnectionTimeoutError extends APIConnectionError {
  constructor({ message }: { message?: string } = {}) {
    super({ message: message ?? 'Request timed out.' })
  }
}

export class APIUserAbortError extends APIError<
  undefined,
  undefined,
  undefined
> {
  constructor({ message }: { message?: string } = {}) {
    super(undefined, undefined, message ?? 'Request was aborted.', undefined)
  }
}

// ── Job-level errors (thrown only by createAndWait — DESIGN §7) ─────────────

/** Catch-all for a job that reached a terminal state other than `completed`. */
export abstract class JobUnsuccessfulError extends SimmitError {
  readonly job: Job

  constructor(job: Job, message?: string) {
    super(
      message ??
        `Job ${job.id} ${job.status}` +
          (job.statusReason ? `: ${job.statusReason}` : '') +
          (job.errorCode ? ` (${job.errorCode})` : '')
    )
    this.job = job
  }
}

export class JobFailedError extends JobUnsuccessfulError {}

/** Includes queue_timeout auto-cancellation, not just user cancels. */
export class JobCancelledError extends JobUnsuccessfulError {}

/** The job hit its runtime ceiling server-side and is billed for what ran. */
export class JobTimedOutError extends JobUnsuccessfulError {}

/**
 * The SDK gave up polling — the job itself is still running and billing.
 * Keep tracking via `jobs.get(jobId)` or stop the spend with `jobs.cancel(jobId)`.
 */
export class JobWaitTimeoutError extends SimmitError {
  readonly jobId: string
  readonly lastStatus: JobStatus

  constructor(args: {
    jobId: string
    lastStatus: JobStatus
    message?: string
  }) {
    super(
      args.message ??
        `Timed out waiting for job ${args.jobId} (last status: ${args.lastStatus}). ` +
          'The job is still running server-side and continues to bill.'
    )
    this.jobId = args.jobId
    this.lastStatus = args.lastStatus
  }
}

// ── Webhook verification (thrown by unwrapWebhook — DESIGN §4) ──────────────

export class WebhookVerificationError extends SimmitError {}
