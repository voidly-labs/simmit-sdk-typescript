import type { APIPromise } from '../api-promise'
import type {
  CompletedJob,
  Job,
  JobCancelResponse,
  JobCreateParams,
  JobCreateResponse,
  JobProfileResponse,
  JobResult,
  JobStatus,
  JobStatusResponse
} from '../api-types'
import type Simmit from '../client'
import type { RequestOptions } from '../client'
import {
  JobCancelledError,
  JobFailedError,
  JobTimedOutError,
  JobWaitTimeoutError
} from '../error'
import { sleep } from '../internal/abort'
import {
  DEFAULT_POLL_INTERVAL_MS,
  deriveWaitTimeoutMs,
  MIN_POLL_INTERVAL_MS,
  nextPollInterval
} from '../internal/poll'
import { isTerminal } from '../status'

export interface JobWaitOptions extends RequestOptions {
  /** Initial delay between status polls, ms. Grows ×1.5 per poll to a 10s cap; values under 100 are raised to it. Default 1_000. */
  pollIntervalMs?: number
  /** Overall wait deadline, ms. Default derived from the job's applied ceilings. */
  waitTimeoutMs?: number
  /** Fired once with the raw create response (job id, ceilings, input warnings) before polling. */
  onCreated?: (response: JobCreateResponse) => void
  /** Fired after every successful status poll (progress, stage, queue estimate). */
  onPoll?: (status: JobStatusResponse) => void
}

/**
 * The `jobs` resource. Each single-request method is a thin wrapper over
 * `client._request` with the path/method/types pinned to the spec;
 * `createAndWait` orchestrates several of them.
 */
export class Jobs {
  readonly #client: Simmit

  constructor(client: Simmit) {
    this.#client = client
  }

  /**
   * Submit a new SimC sim. Returns immediately with the job handle; the sim
   * runs asynchronously. `idempotent: true` makes the request layer attach an
   * auto-generated idempotency key so the POST is safe to retry; pass
   * `options.idempotencyKey` to supply your own.
   */
  create(
    params: JobCreateParams,
    options?: RequestOptions
  ): APIPromise<JobCreateResponse> {
    return this.#client._request<JobCreateResponse>(
      { method: 'POST', path: '/v1/simc/jobs', body: params, idempotent: true },
      options
    )
  }

  /** Fetch the full record for a job. */
  get(jobId: string, options?: RequestOptions): APIPromise<Job> {
    return this.#client._request<Job>(
      { method: 'GET', path: `/v1/simc/jobs/${encodeURIComponent(jobId)}` },
      options
    )
  }

  /**
   * Fetch the live status of a job in any state: `status`, `errorCode`,
   * `progress`, and `queue` estimate. Unlike `getResult`, it never throws for a
   * non-terminal job, so it is the supported way to drive a custom poll loop.
   */
  getStatus(
    jobId: string,
    options?: RequestOptions
  ): APIPromise<JobStatusResponse> {
    return this.#client._request<JobStatusResponse>(
      {
        method: 'GET',
        path: `/v1/simc/jobs/${encodeURIComponent(jobId)}/status`
      },
      options
    )
  }

  /**
   * Fetch the result summary of a terminal job. Throws `ResultNotReadyError`
   * (409) while the job is still running. Poll `/status` or use
   * `createAndWait` rather than `/result` for a job in flight.
   */
  getResult(jobId: string, options?: RequestOptions): APIPromise<JobResult> {
    return this.#client._request<JobResult>(
      {
        method: 'GET',
        path: `/v1/simc/jobs/${encodeURIComponent(jobId)}/result`
      },
      options
    )
  }

  /**
   * Fetch the SimC profile text submitted with a job, available at any point in
   * its lifecycle (including while it is queued or running). `text` is `null`
   * when no profile text is stored for the job.
   */
  getProfile(
    jobId: string,
    options?: RequestOptions
  ): APIPromise<JobProfileResponse> {
    return this.#client._request<JobProfileResponse>(
      {
        method: 'GET',
        path: `/v1/simc/jobs/${encodeURIComponent(jobId)}/profile`
      },
      options
    )
  }

  /**
   * Submit a job and resolve once it reaches a terminal state. Polls
   * `GET /v1/simc/jobs/{id}/status` (first after `pollIntervalMs`, then ×1.5 to
   * a 10s cap), then fetches the full record. Resolves with the `CompletedJob`
   * on success; throws `JobFailedError` / `JobCancelledError` /
   * `JobTimedOutError` for the other terminal states, or `JobWaitTimeoutError`
   * if the deadline passes first. The job keeps running and is **not**
   * cancelled (call `cancel(jobId)` to stop the spend). `signal` aborts the wait
   * with `APIUserAbortError`, also without cancelling.
   */
  async createAndWait(
    params: JobCreateParams,
    options: JobWaitOptions = {}
  ): Promise<CompletedJob> {
    const {
      pollIntervalMs,
      waitTimeoutMs,
      onCreated,
      onPoll,
      ...requestOptions
    } = options

    const created = await this.create(params, requestOptions)
    onCreated?.(created)

    const deadline =
      Date.now() + (waitTimeoutMs ?? deriveWaitTimeoutMs(created))
    // nextPollInterval only ever grows the interval, so a non-positive seed
    // would hot-poll the status endpoint; floor it.
    let interval = Math.max(
      pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      MIN_POLL_INTERVAL_MS
    )
    let lastStatus: JobStatus = 'pending'

    for (;;) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        throw new JobWaitTimeoutError({ jobId: created.id, lastStatus })
      }
      // Never sleep past the deadline, so the wait gives up promptly.
      await sleep(Math.min(interval, remaining), requestOptions.signal)

      const status = await this.getStatus(created.id, requestOptions)
      onPoll?.(status)
      lastStatus = status.status

      if (isTerminal(status.status)) {
        // The status payload is lightweight; the full record carries the fields
        // CompletedJob and the job-error classes expose.
        const job = await this.get(created.id, requestOptions)
        switch (job.status) {
          case 'completed':
            return job as CompletedJob
          case 'failed':
            throw new JobFailedError(job)
          case 'cancelled':
            throw new JobCancelledError(job)
          case 'timed_out':
            throw new JobTimedOutError(job)
        }
        // Raced back to non-terminal between /status and the full record; keep polling.
        lastStatus = job.status
      }
      interval = nextPollInterval(interval)
    }
  }

  /**
   * Request cancellation. Returns `status: 'cancelled'` when the job ended
   * before it ran, or `status: 'cancel_requested'` when an in-flight job was
   * signaled to stop. Repeat calls are naturally idempotent, so no key is sent.
   */
  cancel(
    jobId: string,
    options?: RequestOptions
  ): APIPromise<JobCancelResponse> {
    return this.#client._request<JobCancelResponse>(
      {
        method: 'POST',
        path: `/v1/simc/jobs/${encodeURIComponent(jobId)}/cancel`
      },
      options
    )
  }
}
