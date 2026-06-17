# Simmit SDK for TypeScript

[![CI](https://github.com/voidly-labs/simmit-sdk-typescript/actions/workflows/ci.yml/badge.svg)](https://github.com/voidly-labs/simmit-sdk-typescript/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@simmit/sdk.svg)](https://www.npmjs.com/package/@simmit/sdk)

TypeScript SDK for [Simmit](https://simmit.com), an API for running SimulationCraft in the cloud.

Send the same `.simc` profile you'd run locally and Simmit executes SimulationCraft (SimC) for you on managed hardware, so you can run sims from anywhere that can make an HTTP request, with no local SimC build to manage.

Documentation: [dashboard.simmit.com/docs](https://dashboard.simmit.com/docs)

## Installation

```sh
npm install @simmit/sdk
```

Node 20+. Zero runtime dependencies (global `fetch` and WebCrypto only).

## Usage

```ts
import Simmit from '@simmit/sdk'

const client = new Simmit({
  secretKey: process.env['SIMMIT_SECRET_KEY'] // This is the default and can be omitted
})

// Submit a SimC profile, wait for the sim to finish, and read the result.
const job = await client.jobs.createAndWait({
  build: { channel: 'latest' },
  profile: { text: profileText } // a SimC profile, up to 2 MB
})

const result = await client.jobs.getResult(job.id)
```

The rest of the surface is shown below until an SDK reference lands in the [docs](https://dashboard.simmit.com/docs).

### Progress hooks

`createAndWait` is ideal for scripts and queue workers that can hold a promise
open. Hook into progress, or capture the job id before polling starts:

```ts
await client.jobs.createAndWait(
  { build: { channel: 'latest' }, profile: { text: profileText } },
  {
    onCreated: (res) => console.log('queued', res.id),
    onPoll: (status) => console.log(status.status, status.progress.percent)
  }
)
```

### Submit, poll, and read the result (decoupled)

For web apps that can't hold a promise open, drive the lifecycle yourself:
`create` returns immediately with a job id to persist, then poll `getStatus` on
your own cadence and read the result once terminal. A `job.terminal` webhook is
the reliable completion signal when a browser poll can pause (see below).

```ts
const { id } = await client.jobs.create({
  build: { channel: 'nightly' },
  profile: { text: profileText }
})
// persist `id`, return to the caller, then from a later request:

const status = await client.jobs.getStatus(id) // status + progress, in any state
if (status.status === 'completed') {
  const result = await client.jobs.getResult(id)
}

await client.jobs.cancel(id) // request cancellation
```

### Artifact download URLs

`getResult` returns each artifact with a stable download `url`, valid for the
artifact's full retention window. To fetch that URL on demand instead (e.g. a
browser flow that controls the final fetch), use:

```ts
const { url } = await client.artifacts.getUrl(artifactId)
```

### Credits

```ts
const balance = await client.credits.get()
```

### Errors

Every API error is a typed subclass of `SimmitError`, with a narrowed `code`
and `meta`:

```ts
import { InsufficientCreditsError, InvalidProfileError } from '@simmit/sdk'

try {
  await client.jobs.create({ build: { channel: 'latest' }, profile: { text } })
} catch (err) {
  if (err instanceof InvalidProfileError) {
    console.error(err.meta.blocked) // the rejected profile lines
  } else if (err instanceof InsufficientCreditsError) {
    console.error(err.meta?.maxAffordableRuntimeSeconds)
  } else {
    throw err
  }
}
```

`createAndWait` also throws `JobFailedError` / `JobCancelledError` /
`JobTimedOutError` (each carrying the full `.job`), and `JobWaitTimeoutError` if
the wait deadline passes before the job finishes. The job keeps running, so call
`client.jobs.cancel(jobId)` to stop the spend.

### Response headers

Single-request methods return an `APIPromise`. Await it for the parsed body, or
use `.withResponse()` to reach the raw `Response` (rate-limit headers, idempotent
replays):

```ts
const { data, response } = await client.jobs.create(params).withResponse()
response.headers.get('x-idempotent-replay')
```

### Verifying webhooks

`unwrapWebhook` verifies a webhook signature and returns the parsed event. It is
standalone (no client and no API key required, just your webhook signing
secret), so it is safe to run in a webhook receiver:

```ts
import { unwrapWebhook } from '@simmit/sdk'

const event = await unwrapWebhook(
  rawBody, // the raw request body, exactly as received
  signatureHeader, // the X-Simmit-Signature header value
  process.env.SIMMIT_WEBHOOK_SECRET
)

if (event.payload.status === 'completed') {
  // ...
}
```

## Development

- Node 20+ (`.nvmrc` pins the dev version), pnpm.
- `pnpm generate` regenerates `src/generated/openapi.d.ts` from the committed `openapi.json` snapshot. Never hand-edit generated output; only `src/api-types.ts` may import from `src/generated/`.
- `pnpm build` builds dual ESM+CJS via tsup.
- `pnpm test` runs vitest (hermetic; mocks `fetch`, no network).
- `pnpm smoke` runs a manual check against a real API (needs `SIMMIT_SECRET_KEY`; set `SIMMIT_PROFILE_FILE` to also run a full create-then-result, or `TEST_API_BASE_URL` to target a non-prod endpoint). See `scripts/smoke.mjs`.

## License

MIT
