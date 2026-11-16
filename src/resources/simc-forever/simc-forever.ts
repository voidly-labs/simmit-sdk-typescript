import type Simmit from '../../client'
import { SimcForeverArtifacts } from './artifacts'
import { SimcForeverJobs } from './jobs'
import { SimcForeverProfiles } from './profiles'

/**
 * The `simcForever` namespace: the SimC Forever edition of the `jobs`,
 * `profiles` and `artifacts` resources. SimC Forever is still in early
 * development, so this surface may change in a minor release.
 */
export class SimcForever {
  readonly jobs: SimcForeverJobs
  readonly profiles: SimcForeverProfiles
  readonly artifacts: SimcForeverArtifacts

  constructor(client: Simmit) {
    this.jobs = new SimcForeverJobs(client)
    this.profiles = new SimcForeverProfiles(client)
    this.artifacts = new SimcForeverArtifacts(client)
  }
}
