import type { JobStatus } from './api-types'

/**
 * Job statuses that are terminal: a job in one of these has stopped and will
 * not change again. Terminal does not mean successful; only `completed` carries
 * a result (`failed`, `cancelled`, and `timed_out` do not).
 */
export const TERMINAL_JOB_STATUSES = [
  'completed',
  'failed',
  'cancelled',
  'timed_out'
] as const satisfies readonly JobStatus[]

/** A `JobStatus` that is terminal: the job has stopped and will not change. */
export type TerminalJobStatus = (typeof TERMINAL_JOB_STATUSES)[number]

/** True when `status` is terminal, i.e. the job has reached an end state. */
export function isTerminal(status: JobStatus): status is TerminalJobStatus {
  return (TERMINAL_JOB_STATUSES as readonly JobStatus[]).includes(status)
}
