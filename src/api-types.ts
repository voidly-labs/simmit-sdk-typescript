// The ONLY file that may import from src/generated/. Maps the generator's
// indexed-access types to the SDK's public names so the generation tool stays
// swappable: nothing else in the codebase sees the generator's shapes.
import type { components, paths } from './generated/openapi'

/** 200-response JSON body of an operation. */
type Ok<T> = T extends {
  responses: { 200: { content: { 'application/json': infer B } } }
}
  ? B
  : never

export type JobCreateParams = NonNullable<
  paths['/v1/simc/jobs']['post']['requestBody']
>['content']['application/json']

export type JobCreateResponse = Ok<paths['/v1/simc/jobs']['post']>

export type Job = Ok<paths['/v1/simc/jobs/{id}']['get']>

export type JobStatus = Job['status']

export type JobErrorCode = NonNullable<Job['errorCode']>

export type CompletedJob = Job & { status: 'completed' }

export type JobResult = Ok<paths['/v1/simc/jobs/{id}/result']['get']>

export type ArtifactUrl = Ok<paths['/v1/simc/artifacts/{id}/url']['get']>

export type JobStatusResponse = Ok<paths['/v1/simc/jobs/{id}/status']['get']>

export type JobProfileResponse = Ok<paths['/v1/simc/jobs/{id}/profile']['get']>

export type JobCancelResponse = Ok<paths['/v1/simc/jobs/{id}/cancel']['post']>

export type CreditBalance = Ok<paths['/v1/simc/credits']['get']>

export type CreditGrant = CreditBalance['grants'][number]

/** Account usage, in-flight snapshot, and per-key limits (GET /v1/simc/usage). */
export type UsageResponse = Ok<paths['/v1/simc/usage']['get']>

export type UsagePeriod = UsageResponse['period']

export type UsageSnapshot = UsageResponse['snapshot']

/** The account's plan terms: metering rate, ceilings, concurrency, compute pool, and priority fees. */
export type UsagePlan = UsageResponse['plan']

/** @deprecated Alias of {@link UsagePlan} with identical contents; the API serves both. Prefer `usage.plan`. */
export type UsageLimits = UsageResponse['limits']

/** A single artifact on a job result (`result.result.artifacts[]`). */
export type Artifact = NonNullable<JobResult['result']>['artifacts'][number]

export type ArtifactKind = Artifact['kind']

export type ArtifactMimeType = Artifact['mimeType']

/** The `job.terminal` webhook payload, derived from the spec's schema. */
export type WebhookEvent = components['schemas']['WebhookEvent']
