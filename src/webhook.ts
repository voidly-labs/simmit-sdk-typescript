// Standalone webhook verification. Not a client method: receivers must not
// need a secret-key-bearing client (whose constructor throws without a key).
// WebCrypto only, zero deps, and runs in Workers as well as Node.
import type { JobStatus } from './api-types'
import { WebhookVerificationError } from './error'

const DEFAULT_TOLERANCE_SECONDS = 300

/** The one hand-written wire type: the webhook payload has no OpenAPI schema. */
export interface WebhookEvent {
  kind: 'job.terminal'
  version: 'v1'
  timestamp: string
  payload: {
    id: string
    statusReason: string | null
    status: Extract<
      JobStatus,
      'completed' | 'failed' | 'cancelled' | 'timed_out'
    >
  }
}

/**
 * Verifies an `X-Simmit-Signature` header (`t=<unix>,v1=<hex>`, an HMAC-SHA256
 * (timing-safe) over `${t}.${rawBody}` within a 300s default tolerance) and
 * returns the parsed event. Throws `WebhookVerificationError` on a bad
 * signature, malformed header, or stale timestamp.
 *
 * Pass `rawBody` exactly as received: re-serializing changes the bytes and
 * breaks verification. `secret` is the webhook signing secret (dashboard →
 * Clients & Keys → Webhook), not your API key.
 */
export async function unwrapWebhook(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  options?: { toleranceSeconds?: number }
): Promise<WebhookEvent> {
  // An empty secret would otherwise surface as an opaque WebCrypto DataError;
  // a NaN tolerance would make the age check pass for everything.
  if (!secret) {
    throw new WebhookVerificationError('Webhook signing secret is empty.')
  }
  const tolerance = options?.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new WebhookVerificationError(
      'toleranceSeconds must be a non-negative number.'
    )
  }

  const { timestampRaw, timestamp, signature } =
    parseSignatureHeader(signatureHeader)

  const expected = await hmacSha256Hex(secret, `${timestampRaw}.${rawBody}`)
  if (!timingSafeEqual(expected, signature)) {
    throw new WebhookVerificationError('Webhook signature does not match.')
  }

  // Compare on whole seconds, matching the header's unix-seconds `t`.
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > tolerance) {
    throw new WebhookVerificationError(
      'Webhook timestamp is outside the tolerance window.'
    )
  }

  try {
    return JSON.parse(rawBody) as WebhookEvent
  } catch {
    throw new WebhookVerificationError('Webhook body is not valid JSON.')
  }
}

function parseSignatureHeader(header: string): {
  timestampRaw: string
  timestamp: number
  signature: string
} {
  let timestampRaw: string | undefined
  let signature: string | undefined
  for (const part of header.split(',')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (key === 't') timestampRaw = value
    else if (key === 'v1') signature = value
  }

  // `t` is unix whole seconds; reject anything but digits so the accepted
  // header matches the documented contract.
  if (!timestampRaw || !signature || !/^\d+$/.test(timestampRaw)) {
    throw new WebhookVerificationError(
      'Malformed signature header; expected "t=<unix>,v1=<hex>".'
    )
  }
  // The signed payload uses the timestamp exactly as sent, so keep the raw
  // string for signing and the parsed number only for the tolerance check.
  return { timestampRaw, timestamp: Number(timestampRaw), signature }
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return toHex(new Uint8Array(mac))
}

function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

// Constant-time comparison. The digest width is public, so a length mismatch
// may short-circuit without leaking secret-dependent timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}
