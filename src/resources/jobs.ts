import type { APIPromise } from '../api-promise'
import type {
  Job,
  JobCancelResponse,
  JobCreateParams,
  JobCreateResponse,
  JobResult
} from '../api-types'
import type Simmit from '../client'
import type { RequestOptions } from '../client'

/**
 * The `jobs` resource. Each method is a thin wrapper over `client._request`
 * with the path/method/types pinned to the spec (DESIGN §4); `createAndWait`
 * (DESIGN §7) lands separately and orchestrates these.
 */
export class Jobs {
  readonly #client: Simmit

  constructor(client: Simmit) {
    this.#client = client
  }

  /**
   * Submit a new SimC sim. Returns immediately with the job handle; the sim
   * runs asynchronously. `idempotent: true` makes the request layer attach an
   * auto-generated idempotency key so the POST is safe to retry (DESIGN §6);
   * pass `options.idempotencyKey` to supply your own.
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
   * Fetch the result summary of a terminal job. Throws `ResultNotReadyError`
   * (409) while the job is still running — poll `/status` or use
   * `createAndWait` rather than `/result` for a job in flight (DESIGN §6).
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
