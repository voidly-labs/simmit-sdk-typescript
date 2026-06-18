import { describe, expect, it } from 'vitest'
import { isTerminal, TERMINAL_JOB_STATUSES } from '../src/status'

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
