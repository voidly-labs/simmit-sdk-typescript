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
   * Fetch a stable public download URL for an artifact, valid for the
   * artifact's full retention window — the same URL `jobs.getResult` returns,
   * fetched on demand (e.g. browser flows that control the final fetch). The
   * artifact is gone (410) once its retention window passes.
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
