import type { APIPromise } from '../../api-promise'
import type {
  SimcForeverProfileCheckParams,
  SimcForeverProfileCheckResponse
} from '../../api-types'
import type Simmit from '../../client'
import type { RequestOptions } from '../../client'

/** The `simcForever.profiles` resource. */
export class SimcForeverProfiles {
  readonly #client: Simmit

  constructor(client: Simmit) {
    this.#client = client
  }

  /**
   * Check SimC profile text against the rules `simcForever.jobs.create`
   * applies, without creating a job or using credits. Behaves as
   * `profiles.check` does: resolves with any input `warnings`, throws the
   * rejection a submission would, and sends no idempotency key.
   */
  check(
    params: SimcForeverProfileCheckParams,
    options?: RequestOptions
  ): APIPromise<SimcForeverProfileCheckResponse> {
    return this.#client._request<SimcForeverProfileCheckResponse>(
      { method: 'POST', path: '/v1/simc-forever/profiles/check', body: params },
      options
    )
  }
}
