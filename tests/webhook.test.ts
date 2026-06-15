import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebhookVerificationError } from '../src/error'
import { unwrapWebhook } from '../src/webhook'

const SECRET = 'whsec_test'
const FIXED_MS = 1_760_000_000_000
const NOW = FIXED_MS / 1000 // whole seconds

const eventBody = JSON.stringify({
  kind: 'job.terminal',
  version: 'v1',
  timestamp: '2026-10-09T07:33:20.000Z',
  payload: { id: 'job_123', statusReason: null, status: 'completed' }
})

function sign(secret: string, t: number | string, body: string): string {
  return createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
}

function header(
  body: string,
  opts: { secret?: string; t?: number } = {}
): string {
  const secret = opts.secret ?? SECRET
  const t = opts.t ?? NOW
  return `t=${t},v1=${sign(secret, t, body)}`
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_MS)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('unwrapWebhook', () => {
  it('returns the parsed event for a valid signature', async () => {
    const event = await unwrapWebhook(eventBody, header(eventBody), SECRET)
    expect(event.kind).toBe('job.terminal')
    expect(event.version).toBe('v1')
    expect(event.payload).toEqual({
      id: 'job_123',
      statusReason: null,
      status: 'completed'
    })
  })

  it('rejects a tampered body', async () => {
    const stale = header(eventBody) // signed over the original body
    await expect(
      unwrapWebhook(eventBody + ' ', stale, SECRET)
    ).rejects.toBeInstanceOf(WebhookVerificationError)
  })

  it('rejects a signature made with the wrong secret', async () => {
    await expect(
      unwrapWebhook(
        eventBody,
        header(eventBody, { secret: 'whsec_wrong' }),
        SECRET
      )
    ).rejects.toBeInstanceOf(WebhookVerificationError)
  })

  it('accepts a timestamp exactly at the tolerance edge', async () => {
    const h = header(eventBody, { t: NOW - 300 })
    await expect(unwrapWebhook(eventBody, h, SECRET)).resolves.toMatchObject({
      kind: 'job.terminal'
    })
  })

  it('rejects a stale timestamp past the tolerance', async () => {
    const h = header(eventBody, { t: NOW - 301 })
    await expect(unwrapWebhook(eventBody, h, SECRET)).rejects.toBeInstanceOf(
      WebhookVerificationError
    )
  })

  it('rejects a far-future timestamp past the tolerance', async () => {
    const h = header(eventBody, { t: NOW + 301 })
    await expect(unwrapWebhook(eventBody, h, SECRET)).rejects.toBeInstanceOf(
      WebhookVerificationError
    )
  })

  it('honors a custom toleranceSeconds', async () => {
    const h = header(eventBody, { t: NOW - 301 })
    await expect(unwrapWebhook(eventBody, h, SECRET)).rejects.toBeInstanceOf(
      WebhookVerificationError
    )
    await expect(
      unwrapWebhook(eventBody, h, SECRET, { toleranceSeconds: 600 })
    ).resolves.toMatchObject({ payload: { id: 'job_123' } })
  })

  it.each([
    ['missing v1', `t=${NOW}`],
    ['missing t', `v1=${sign(SECRET, NOW, eventBody)}`],
    ['empty', ''],
    ['no pairs', 'not-a-signature'],
    ['non-numeric t', `t=abc,v1=${sign(SECRET, 'abc', eventBody)}`],
    ['exponent t', `t=1e3,v1=${sign(SECRET, '1e3', eventBody)}`],
    ['fractional t', `t=100.5,v1=${sign(SECRET, '100.5', eventBody)}`]
  ])('rejects a malformed header (%s)', async (_label, sigHeader) => {
    await expect(
      unwrapWebhook(eventBody, sigHeader, SECRET)
    ).rejects.toBeInstanceOf(WebhookVerificationError)
  })

  it('rejects a signature of the wrong length', async () => {
    await expect(
      unwrapWebhook(eventBody, `t=${NOW},v1=deadbeef`, SECRET)
    ).rejects.toBeInstanceOf(WebhookVerificationError)
  })

  it('rejects an empty signing secret rather than throwing a crypto error', async () => {
    await expect(
      unwrapWebhook(eventBody, header(eventBody), '')
    ).rejects.toBeInstanceOf(WebhookVerificationError)
  })

  it('rejects an invalid toleranceSeconds instead of disabling the check', async () => {
    await expect(
      unwrapWebhook(eventBody, header(eventBody), SECRET, {
        toleranceSeconds: NaN
      })
    ).rejects.toBeInstanceOf(WebhookVerificationError)
  })

  it('compares on whole seconds, so a sub-second clock does not shift the edge', async () => {
    vi.setSystemTime(FIXED_MS + 900) // 0.9s into the current second
    const h = header(eventBody, { t: NOW - 300 })
    await expect(unwrapWebhook(eventBody, h, SECRET)).resolves.toMatchObject({
      kind: 'job.terminal'
    })
  })

  it('rejects an authentic body that is not valid JSON', async () => {
    const body = 'not json'
    await expect(
      unwrapWebhook(body, header(body), SECRET)
    ).rejects.toBeInstanceOf(WebhookVerificationError)
  })

  it('tolerates surrounding spaces and key order in the header', async () => {
    const sig = sign(SECRET, NOW, eventBody)
    const h = ` v1=${sig} , t=${NOW} `
    await expect(unwrapWebhook(eventBody, h, SECRET)).resolves.toMatchObject({
      kind: 'job.terminal'
    })
  })
})
