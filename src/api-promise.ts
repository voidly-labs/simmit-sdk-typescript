/**
 * A `Promise<T>` with raw-response access — the generic answer to response
 * headers the return types can't see (`X-Idempotent-Replay`, `X-Active-Jobs`,
 * `X-RateLimit-*`).
 *
 *     const { data, response } = await client.jobs.create(params).withResponse()
 *     response.headers.get('x-idempotent-replay')
 */
export class APIPromise<T> extends Promise<T> {
  // Chained promises (.then/.catch) must be plain Promises: this class's
  // constructor signature is incompatible with the executor the runtime
  // would otherwise pass via the species constructor.
  static override get [Symbol.species]() {
    return Promise
  }

  readonly #parsed: Promise<{ data: T; response: Response }>

  constructor(parsed: Promise<{ data: T; response: Response }>) {
    super((resolve, reject) => {
      parsed.then(result => resolve(result.data), reject)
    })
    this.#parsed = parsed
  }

  withResponse(): Promise<{ data: T; response: Response }> {
    return this.#parsed
  }

  asResponse(): Promise<Response> {
    return this.#parsed.then(result => result.response)
  }
}
