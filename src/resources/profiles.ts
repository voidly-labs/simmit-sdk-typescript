import type { APIPromise } from '../api-promise'
import type { ProfileCheckParams, ProfileCheckResponse } from '../api-types'
import type Simmit from '../client'
import type { RequestOptions } from '../client'

/** The `profiles` resource. */
export class Profiles {
  readonly #client: Simmit

  constructor(client: Simmit) {
    this.#client = client
  }

  /**
   * Check SimC profile text against the rules `jobs.create` applies, without
   * creating a job or using credits. Resolves with any input `warnings`; a
   * rejection throws the same `InvalidProfileError` / `TooManyVariantsError` a
   * submission would. A partial profile works too. A repeat check has no side
   * effects, so no idempotency key is sent.
   */
  check(
    params: ProfileCheckParams,
    options?: RequestOptions
  ): APIPromise<ProfileCheckResponse> {
    return this.#client._request<ProfileCheckResponse>(
      { method: 'POST', path: '/v1/simc/profiles/check', body: params },
      options
    )
  }
}
