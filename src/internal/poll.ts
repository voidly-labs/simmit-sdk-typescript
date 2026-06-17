// Pure helpers for the createAndWait poll loop. Kept separate from the
// orchestration so the cadence and deadline math are unit-testable.
import type { JobCreateResponse, JobStatus } from '../api-types'

export const MIN_POLL_INTERVAL_MS = 100
export const DEFAULT_POLL_INTERVAL_MS = 1_000
export const MAX_POLL_INTERVAL_MS = 10_000
export const POLL_BACKOFF_FACTOR = 1.5
const DEADLINE_GRACE_MS = 60_000
const FALLBACK_WAIT_TIMEOUT_MS = 45 * 60 * 1_000

const TERMINAL_STATUSES = new Set<JobStatus>([
  'completed',
  'failed',
  'cancelled',
  'timed_out'
])

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

/**
 * Default wait deadline derived from the applied ceilings the create response
 * reports: `(queueSeconds + runtimeSeconds) × 1000` plus a 60s grace, falling
 * back to 45 minutes when either ceiling is null.
 */
export function deriveWaitTimeoutMs(created: JobCreateResponse): number {
  const { runtimeSeconds, queueSeconds } = created.runtime.ceiling
  if (runtimeSeconds != null && queueSeconds != null) {
    return (runtimeSeconds + queueSeconds) * 1_000 + DEADLINE_GRACE_MS
  }
  return FALLBACK_WAIT_TIMEOUT_MS
}

/** Next poll interval: grow ×1.5, capped at 10s. */
export function nextPollInterval(interval: number): number {
  return Math.min(interval * POLL_BACKOFF_FACTOR, MAX_POLL_INTERVAL_MS)
}
