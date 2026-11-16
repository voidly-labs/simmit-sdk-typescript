import type { APIPromise } from '../../api-promise'
import type {
  SimcForeverJob,
  SimcForeverJobCancelResponse,
  SimcForeverJobCreateParams,
  SimcForeverJobCreateResponse,
  SimcForeverJobListParams,
  SimcForeverJobListResponse,
  SimcForeverJobProfileResponse,
  SimcForeverJobResult,
  SimcForeverJobStatusResponse
} from '../../api-types'
import type Simmit from '../../client'
import type { RequestOptions } from '../../client'
import type { JobStatusOptions } from '../jobs'

/** The `simcForever.jobs` resource. */
export class SimcForeverJobs {
  readonly #client: Simmit

  constructor(client: Simmit) {
    this.#client = client
  }

  /**
   * Submit a new SimC Forever sim. Returns immediately with the job handle;
   * the sim runs asynchronously. An idempotency key is attached as on
   * `jobs.create`; pass `options.idempotencyKey` to supply your own.
   */
  create(
    params: SimcForeverJobCreateParams,
    options?: RequestOptions
  ): APIPromise<SimcForeverJobCreateResponse> {
    return this.#client._request<SimcForeverJobCreateResponse>(
      {
        method: 'POST',
        path: '/v1/simc-forever/jobs',
        body: params,
        idempotent: true
      },
      options
    )
  }

  /**
   * List your recent SimC Forever jobs, newest first. Pages like `jobs.list`:
   * `params.limit`, `params.cursor`, and the response's `page.nextCursor`.
   */
  list(
    params: SimcForeverJobListParams = {},
    options?: RequestOptions
  ): APIPromise<SimcForeverJobListResponse> {
    return this.#client._request<SimcForeverJobListResponse>(
      {
        method: 'GET',
        path: '/v1/simc-forever/jobs',
        query: { limit: params.limit, cursor: params.cursor }
      },
      options
    )
  }

  /** Fetch the full record for a SimC Forever job. */
  get(jobId: string, options?: RequestOptions): APIPromise<SimcForeverJob> {
    return this.#client._request<SimcForeverJob>(
      {
        method: 'GET',
        path: `/v1/simc-forever/jobs/${encodeURIComponent(jobId)}`
      },
      options
    )
  }

  /**
   * Fetch the live status of a SimC Forever job in any state. Never throws
   * for a non-terminal job, so it is the way to drive a poll loop. Pass
   * `include: ['logEntries']` to add log lines for a running job.
   */
  getStatus(
    jobId: string,
    options?: JobStatusOptions
  ): APIPromise<SimcForeverJobStatusResponse> {
    const { include, ...requestOptions } = options ?? {}
    return this.#client._request<SimcForeverJobStatusResponse>(
      {
        method: 'GET',
        path: `/v1/simc-forever/jobs/${encodeURIComponent(jobId)}/status`,
        ...(include?.length ? { query: { include: include.join(',') } } : {})
      },
      requestOptions
    )
  }

  /**
   * Fetch the result summary of a terminal SimC Forever job. Throws
   * `ResultNotReadyError` (409) while the job is still running.
   */
  getResult(
    jobId: string,
    options?: RequestOptions
  ): APIPromise<SimcForeverJobResult> {
    return this.#client._request<SimcForeverJobResult>(
      {
        method: 'GET',
        path: `/v1/simc-forever/jobs/${encodeURIComponent(jobId)}/result`
      },
      options
    )
  }

  /** Fetch the SimC profile text submitted with a SimC Forever job. */
  getProfile(
    jobId: string,
    options?: RequestOptions
  ): APIPromise<SimcForeverJobProfileResponse> {
    return this.#client._request<SimcForeverJobProfileResponse>(
      {
        method: 'GET',
        path: `/v1/simc-forever/jobs/${encodeURIComponent(jobId)}/profile`
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
  ): APIPromise<SimcForeverJobCancelResponse> {
    return this.#client._request<SimcForeverJobCancelResponse>(
      {
        method: 'POST',
        path: `/v1/simc-forever/jobs/${encodeURIComponent(jobId)}/cancel`
      },
      options
    )
  }
}
