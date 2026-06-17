// The ONLY file that may import from src/generated/. Maps the generator's
// indexed-access types to the SDK's public names so the generation tool stays
// swappable: nothing else in the codebase sees the generator's shapes.
import type { paths } from './generated/openapi'

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

export type JobCancelResponse = Ok<paths['/v1/simc/jobs/{id}/cancel']['post']>

export type CreditBalance = Ok<paths['/v1/simc/credits']['get']>

export type CreditGrant = CreditBalance['grants'][number]
