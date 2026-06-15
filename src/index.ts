// Public entry point. Surface specified in DESIGN.md.
export { default, default as Simmit } from './client'
export type { ClientOptions, RequestOptions } from './client'
export { APIPromise } from './api-promise'
export * from './error'
export type * from './api-types'
// Resource classes are instantiated by the client (`client.jobs`, `client.credits`);
// exported as types only so callers can annotate without constructing them.
export type { Jobs } from './resources/jobs'
export type { Credits } from './resources/credits'
