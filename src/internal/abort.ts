// Abort-aware timing utilities shared by the request layer (backoff sleeps) and
// the createAndWait poll loop. A pending sleep rejects with APIUserAbortError
// the moment the caller's signal fires.
import { APIUserAbortError } from '../error'

export function throwIfUserAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new APIUserAbortError()
}

export function sleep(
  ms: number,
  signal: AbortSignal | undefined
): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfUserAborted(signal)
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timeoutId)
      reject(new APIUserAbortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
