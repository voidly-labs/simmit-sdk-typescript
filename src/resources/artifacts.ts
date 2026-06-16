import type { APIPromise } from '../api-promise'
import type { ArtifactUrl } from '../api-types'
import type Simmit from '../client'
import type { RequestOptions } from '../client'

/** The `artifacts` resource. */
export class Artifacts {
  readonly #client: Simmit

  constructor(client: Simmit) {
    this.#client = client
  }

  /**
   * Refetch a fresh signed download URL for an artifact. The `url`s returned on
   * `jobs.getResult` expire; call this to renew one for a download that 403s.
   */
  getUrl(
    artifactId: string,
    options?: RequestOptions
  ): APIPromise<ArtifactUrl> {
    return this.#client._request<ArtifactUrl>(
      {
        method: 'GET',
        path: `/v1/simc/artifacts/${encodeURIComponent(artifactId)}/url`
      },
      options
    )
  }
}
