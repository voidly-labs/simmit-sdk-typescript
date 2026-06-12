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
    // The base promise is a pre-settled placeholder that is never observed:
    // then() below delegates to #parsed lazily (catch/finally route through
    // then() per spec). Subscribing eagerly here would reject this instance
    // even when the caller only consumes withResponse(), leaking an
    // unhandled rejection on failures.
    super((resolve) => resolve(undefined as never))
    this.#parsed = parsed
  }

  override then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.#parsed
      .then((result) => result.data)
      .then(onfulfilled, onrejected)
  }

  withResponse(): Promise<{ data: T; response: Response }> {
    return this.#parsed
  }

  asResponse(): Promise<Response> {
    return this.#parsed.then((result) => result.response)
  }
}
