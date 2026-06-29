import type { APIPromise } from '../api-promise'
import type { UsageResponse } from '../api-types'
import type Simmit from '../client'
import type { RequestOptions } from '../client'

/** The `usage` resource. */
export class Usage {
  readonly #client: Simmit

  constructor(client: Simmit) {
    this.#client = client
  }

  /**
   * Fetch the account's current-period usage, in-flight job snapshot, and
   * per-key limits. `limits.maxActiveJobs` is the concurrency ceiling and
   * `snapshot.activeJobs` the current count (both `number | null`), so the two
   * together drive a concurrency gauge without waiting for a 429.
   */
  get(options?: RequestOptions): APIPromise<UsageResponse> {
    return this.#client._request<UsageResponse>(
      { method: 'GET', path: '/v1/simc/usage' },
      options
    )
  }
}
