// Public entry point. Surface specified in DESIGN.md.
export { default, default as Simmit } from './client'
export type { ClientOptions, RequestOptions } from './client'
export { APIPromise } from './api-promise'
export * from './error'
export type * from './api-types'
// Resource classes are instantiated by the client (`client.jobs`, `client.credits`);
// exported as types only so callers can annotate without constructing them.
export type { Jobs, JobWaitOptions } from './resources/jobs'
export type { Credits } from './resources/credits'
export type { Artifacts } from './resources/artifacts'
// Standalone webhook verification: no client (and no secret key) required.
export { unwrapWebhook } from './webhook'
export type { WebhookEvent } from './webhook'
// Status predicates: pure, no client required.
export { isCompleted, isTerminal, TERMINAL_JOB_STATUSES } from './status'
export type { TerminalJobStatus } from './status'
