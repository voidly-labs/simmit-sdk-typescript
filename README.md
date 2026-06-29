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

A Simmit **job** is one SimC run: you submit a profile, Simmit queues and runs it in the cloud, and you fetch the result when it's done.

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

### Account usage and limits

```ts
const usage = await client.usage.get()
usage.limits.maxActiveJobs // the key's concurrency ceiling (number | null)
usage.snapshot.activeJobs // jobs in flight right now (number | null)
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

## Using the SDK in a web app

The SDK is server-side only: the secret key spends credits and must never reach
the browser. A typical web flow submits a job on one request, persists the
returned id, and reads the result on a later request. A `job.terminal` webhook
(above) is the reliable completion signal.

### Construct the client lazily

`new Simmit()` throws when no secret key is set. Frameworks that evaluate route
modules at build time (Next.js, Remix, SvelteKit) run that code with no
environment, so a top-level `new Simmit()` breaks the build. Construct it lazily
so the key is read at first use, on a real request:

```ts
// lib/simmit.ts
import 'server-only'
import Simmit from '@simmit/sdk'

let client: Simmit | undefined

export function simmit(): Simmit {
  return (client ??= new Simmit())
}
```

The `server-only` import fails the build if this module is ever pulled into a
client component.

### Make submit idempotent

`jobs.create` attaches a fresh idempotency key per call, which keeps the SDK's
own retries safe. It does not cover a user double-clicking submit: that is two
calls, and two billed jobs. Pass a stable key (for example a per-render form
nonce) so the second submit replays the first job instead of creating another:

```ts
await simmit().jobs.create(params, { idempotencyKey: formNonce })
```

### Branch on the result

Use `isTerminal` to tell whether the job is still running. A plain
`job.status === 'completed'` check narrows a finished job to `CompletedJob`
before you read its result:

```ts
import { isTerminal } from '@simmit/sdk'
import { simmit } from '@/lib/simmit'

const job = await simmit().jobs.get(id)

if (!isTerminal(job.status)) {
  // still running: send the caller back to a progress view
  return
}

if (job.status !== 'completed') {
  // terminal but not successful: 'failed' | 'cancelled' | 'timed_out'
  console.error(job.statusReason)
  return
}

// job is CompletedJob here (=== 'completed' narrowed it)
const { result } = await simmit().jobs.getResult(job.id)
const actor = result.summary?.mainActor
// mainActor is null for a completed run with no single headline actor (a
// profileset-only or multi-player sim keeps per-actor numbers in the JSON
// artifact), so guard it even on success.
const dps = actor ? Math.round(actor.mean) : null
```

## Development

- Node 20+ (`.nvmrc` pins the dev version), pnpm.
- `pnpm generate` regenerates `src/generated/openapi.d.ts` from the committed `openapi.json` snapshot. Never hand-edit generated output; only `src/api-types.ts` may import from `src/generated/`.
- `pnpm build` builds dual ESM+CJS via tsup.
- `pnpm test` runs vitest (hermetic; mocks `fetch`, no network).
- `pnpm smoke` runs a manual check against a real API (needs `SIMMIT_SECRET_KEY`; set `SIMMIT_PROFILE_FILE` to also run a full create-then-result, or `TEST_API_BASE_URL` to target a non-prod endpoint). See `scripts/smoke.mjs`.

## License

MIT
