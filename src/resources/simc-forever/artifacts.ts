import type { APIPromise } from '../../api-promise'
import type { SimcForeverArtifactUrl } from '../../api-types'
import type Simmit from '../../client'
import type { RequestOptions } from '../../client'

/** The `simcForever.artifacts` resource. */
export class SimcForeverArtifacts {
  readonly #client: Simmit

  constructor(client: Simmit) {
    this.#client = client
  }

  /**
   * Fetch a public download URL for a SimC Forever job artifact, valid for
   * the artifact's retention window. The artifact is gone (410) once that
   * window passes.
   */
  getUrl(
    artifactId: string,
    options?: RequestOptions
  ): APIPromise<SimcForeverArtifactUrl> {
    return this.#client._request<SimcForeverArtifactUrl>(
      {
        method: 'GET',
        path: `/v1/simc-forever/artifacts/${encodeURIComponent(artifactId)}/url`
      },
      options
    )
  }
}
