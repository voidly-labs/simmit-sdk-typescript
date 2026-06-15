import type { APIPromise } from '../api-promise'
import type { CreditBalance } from '../api-types'
import type Simmit from '../client'
import type { RequestOptions } from '../client'

/** The `credits` resource. */
export class Credits {
  readonly #client: Simmit

  constructor(client: Simmit) {
    this.#client = client
  }

  /** Fetch the account's current credit balance and per-grant breakdown. */
  get(options?: RequestOptions): APIPromise<CreditBalance> {
    return this.#client._request<CreditBalance>(
      { method: 'GET', path: '/v1/simc/credits' },
      options
    )
  }
}
