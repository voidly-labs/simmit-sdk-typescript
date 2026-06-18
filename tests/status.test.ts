import { describe, expect, it } from 'vitest'
import type { Job } from '../src/api-types'
import { isCompleted, isTerminal, TERMINAL_JOB_STATUSES } from '../src/status'

const jobWith = (status: Job['status']): Job => ({ status }) as unknown as Job

describe('isTerminal', () => {
  it('is true for the terminal statuses', () => {
    expect(isTerminal('completed')).toBe(true)
    expect(isTerminal('failed')).toBe(true)
    expect(isTerminal('cancelled')).toBe(true)
    expect(isTerminal('timed_out')).toBe(true)
  })

  it('is false for the in-flight statuses', () => {
    expect(isTerminal('pending')).toBe(false)
    expect(isTerminal('queued')).toBe(false)
    expect(isTerminal('starting')).toBe(false)
    expect(isTerminal('running')).toBe(false)
  })
})

describe('isCompleted', () => {
  it('is true only for a completed job', () => {
    expect(isCompleted(jobWith('completed'))).toBe(true)
    expect(isCompleted(jobWith('failed'))).toBe(false)
    expect(isCompleted(jobWith('running'))).toBe(false)
  })

  it('narrows the job to CompletedJob', () => {
    const job = jobWith('completed')
    if (!isCompleted(job)) throw new Error('expected isCompleted to narrow')
    const status: 'completed' = job.status
    expect(status).toBe('completed')
  })
})

describe('TERMINAL_JOB_STATUSES', () => {
  it('is exactly the four terminal statuses', () => {
    expect([...TERMINAL_JOB_STATUSES]).toEqual([
      'completed',
      'failed',
      'cancelled',
      'timed_out'
    ])
  })
})
