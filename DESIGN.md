# Simmit TypeScript SDK: v1 Design (revision 2.8)

Scope: public surface and foundations only, a design proposal, not an implementation.
Convention reference: `anthropic-sdk-typescript`; where this doc is silent, that SDK's idiom is
the answer. Spec/docs/review disagreements about a shape resolve to `openapi-typescript` output
from the live spec as ground truth; overrides are flagged inline.

Fixed decisions (not relitigated): handwritten thin client over `openapi-typescript`-generated
types; Node 20+; zero runtime deps; global `fetch`; dual ESM+CJS via tsup; `SIMMIT_SECRET_KEY`
bearer auth; auto-retry 429/5xx with backoff + `Retry-After`; auto idempotency key on creation.
v1 scope: `jobs.create`/`get`/`getResult`/`createAndWait`/`cancel`, `credits.get`, standalone
webhook verification, typed errors.

## 1. Package name and file layout

**Recommendation: `@simmit/sdk`.** Mirrors `@anthropic-ai/sdk`, squat-proof, leaves room for
future `@simmit/*`. Alternative: unscoped `simmit`, OpenAI-style, only if free and forever.

```
simmit-sdk/
├── openapi.json                  # committed spec snapshot the types are generated from
└── src/
    ├── index.ts                  # public entry: Simmit (default), errors, types, APIPromise, webhook
    ├── client.ts                 # Simmit class, ClientOptions, RequestOptions
    ├── api-promise.ts            # APIPromise<T> (§4)
    ├── error.ts                  # full error hierarchy (§5)
    ├── webhook.ts                # standalone unwrapWebhook (§4); WebCrypto only
    ├── api-types.ts              # handwritten public aliases over generated types (the seam)
    ├── resources/                # jobs.ts, credits.ts
    ├── internal/                 # not exported: request layer, retry/backoff, idempotency, polling
    └── generated/
        └── openapi.d.ts          # openapi-typescript output. Tool-owned. Never hand-edited.
```

**Generated/handwritten boundary.** `src/generated/` contains only tool output (a single
type-only `.d.ts` from `npx openapi-typescript openapi.json`), is excluded from lint/prettier,
and is regenerated in CI with a drift check (regenerate → `git diff --exit-code`). Exactly one
handwritten file, `api-types.ts`, may import from `generated/`:

```ts
// src/api-types.ts: the ONLY file that imports from src/generated/
import type { paths } from './generated/openapi'
type Ok<P extends keyof paths, M> = ... // shorthand: 200-response JSON body at paths[P][M]

export type JobCreateParams = NonNullable<paths['/v1/simc/jobs']['post']['requestBody']>['content']['application/json']
export type JobCreateResponse = Ok<'/v1/simc/jobs', 'post'>
export type Job = Ok<'/v1/simc/jobs/{id}', 'get'>
export type JobStatus = Job['status'] // 'pending' | 'queued' | ... | 'timed_out'
export type JobErrorCode = NonNullable<Job['errorCode']>
export type CompletedJob = Job & { status: 'completed' }
export type JobResult = Ok<'/v1/simc/jobs/{id}/result', 'get'>
export type JobStatusResponse = Ok<'/v1/simc/jobs/{id}/status', 'get'>
export type JobProfileResponse = Ok<'/v1/simc/jobs/{id}/profile', 'get'>
export type JobCancelResponse = Ok<'/v1/simc/jobs/{id}/cancel', 'post'>
export type CreditBalance = Ok<'/v1/simc/credits', 'get'>
export type CreditGrant = CreditBalance['grants'][number]
```

Swapping the generator later means rewriting `api-types.ts` only; nothing else sees its shapes.
`WebhookEvent` (§4) is derived from the spec's schema (added upstream in 1.2.0, §8.9), so there are no hand-written wire types.
Publishing: tsup → `dist/`, `exports` map (ESM+CJS+`.d.ts`), `engines.node: ">=20"`, `sideEffects: false`.

## 2. Client constructor

```ts
export default class Simmit {
  readonly jobs: Jobs
  readonly credits: Credits
  readonly artifacts: Artifacts
  readonly usage: Usage
  constructor(options?: ClientOptions)
}

export interface ClientOptions {
  /** Defaults to process.env['SIMMIT_SECRET_KEY'], exactly one env fallback. Construction
   *  throws SimmitError('Missing secret key. Pass secretKey or set SIMMIT_SECRET_KEY.').
   *  "Secret key" is the credential noun end to end (dashboard → docs → env var → option →
   *  error): it spends credits and must never ship client-side. */
  secretKey?: string | null
  /** Defaults to process.env['SIMMIT_BASE_URL'] ?? 'https://api.simmit.com'. */
  baseURL?: string | null
  /** Per-attempt timeout in ms. Default 60_000. (Retries can extend total wall time.) */
  timeout?: number
  /** Max retries after the first attempt for retryable failures (§6). Default 2. */
  maxRetries?: number
  /** Headers sent with every request. Merged under per-request headers. */
  defaultHeaders?: Record<string, string | null | undefined>
  /** Custom fetch (testing, proxies). Defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch
  /** Extra RequestInit fields passed to every fetch call (e.g. undici dispatcher). */
  fetchOptions?: RequestInit
}
```

Deliberately omitted vs. Anthropic: `authToken`/OAuth, profiles, middleware, logging hooks. No
v1 use case; surface added later is cheap, surface removed is not.

## 3. Per-request options and precedence

Every method takes a trailing `options?: RequestOptions`, Anthropic-style:

```ts
export interface RequestOptions {
  /** Per-attempt timeout in ms. Overrides ClientOptions.timeout. */
  timeout?: number
  /** Abort the call (including retries and waiting). Throws APIUserAbortError. Never retried. */
  signal?: AbortSignal
  /** Overrides ClientOptions.maxRetries for this call. */
  maxRetries?: number
  /** Merged over defaultHeaders; a null value deletes the header. */
  headers?: Record<string, string | null | undefined>
  /** jobs.create / jobs.createAndWait only: replaces the auto-generated idempotency-key. */
  idempotencyKey?: string
}
```

**Precedence rule: per-request option > constructor option > SDK built-in default.** Scalars
replace; `headers` merge per-key (per-request wins, `null` deletes). `timeout` and `signal`
compose: first to fire aborts (timeout → `APIConnectionTimeoutError`, retryable; user signal →
`APIUserAbortError`, terminal).

## 4. Resources and method signatures

`api.md`-style listing. Types: `Job` · `JobCreateParams` · `JobCreateResponse` · `JobStatus` ·
`TerminalJobStatus` · `JobErrorCode` · `CompletedJob` · `JobResult` · `JobStatusResponse` · `JobProfileResponse` · `JobCancelResponse` ·
`CreditBalance` · `CreditGrant` · `UsageResponse` · `UsagePeriod` · `UsageSnapshot` · `UsagePlan` · `UsageLimits` · `ArtifactUrl` · `Artifact` · `ArtifactKind` · `ArtifactMimeType` · `WebhookEvent`

- <code title="post /v1/simc/jobs">client.jobs.create({ ...params }, options?) -> JobCreateResponse</code>
- <code title="get /v1/simc/jobs/{id}">client.jobs.get(jobId, options?) -> Job</code>
- <code title="get /v1/simc/jobs/{id}/status">client.jobs.getStatus(jobId, options?) -> JobStatusResponse</code>
- <code title="get /v1/simc/jobs/{id}/result">client.jobs.getResult(jobId, options?) -> JobResult</code>
- <code title="get /v1/simc/jobs/{id}/profile">client.jobs.getProfile(jobId, options?) -> JobProfileResponse</code>
- <code title="post /v1/simc/jobs + poll get /v1/simc/jobs/{id}/status">client.jobs.createAndWait({ ...params }, waitOptions?) -> CompletedJob</code>
- <code title="post /v1/simc/jobs/{id}/cancel">client.jobs.cancel(jobId, options?) -> JobCancelResponse</code>
- <code title="get /v1/simc/credits">client.credits.get(options?) -> CreditBalance</code>
- <code title="get /v1/simc/artifacts/{id}/url">client.artifacts.getUrl(artifactId, options?) -> ArtifactUrl</code>
- <code title="get /v1/simc/usage">client.usage.get(options?) -> UsageResponse</code>

Standalone status helpers (pure, no client; for the decoupled and webhook flows where consumers branch on a job's state):

- <code>isTerminal(status: JobStatus) -> status is TerminalJobStatus</code>: the job reached an end state and stopped. There is no clean inline check for the four-state set, which is why this is a helper.
- <code>TERMINAL_JOB_STATUSES</code>: the readonly array backing `isTerminal`, kept in sync with `JobStatus` at compile time.

The success branch needs no helper: `job.status === 'completed'` already narrows a `Job` to `CompletedJob`.

```ts
export class Jobs {
  create(
    params: JobCreateParams,
    options?: RequestOptions
  ): APIPromise<JobCreateResponse>
  get(jobId: string, options?: RequestOptions): APIPromise<Job>
  getStatus(
    jobId: string,
    options?: RequestOptions
  ): APIPromise<JobStatusResponse>
  getResult(jobId: string, options?: RequestOptions): APIPromise<JobResult>
  getProfile(
    jobId: string,
    options?: RequestOptions
  ): APIPromise<JobProfileResponse>
  createAndWait(
    params: JobCreateParams,
    options?: JobWaitOptions
  ): Promise<CompletedJob>
  cancel(jobId: string, options?: RequestOptions): APIPromise<JobCancelResponse>
}

export class Credits {
  get(options?: RequestOptions): APIPromise<CreditBalance>
}

export class Artifacts {
  getUrl(artifactId: string, options?: RequestOptions): APIPromise<ArtifactUrl>
}

export interface JobWaitOptions extends RequestOptions {
  /** Initial delay between status polls, ms. Grows ×1.5 per poll to a 10s cap. Default 1_000. */
  pollIntervalMs?: number
  /** Overall wait deadline, ms. Default derived from the job's ceilings (§7). */
  waitTimeoutMs?: number
  /** Fired once with the raw create response (job id, ceilings, input warnings) before polling. */
  onCreated?: (response: JobCreateResponse) => void
  /** Fired after every successful status poll (progress, stage, queue estimate). */
  onPoll?: (status: JobStatusResponse) => void
}
```

`jobs.cancel` is promoted into v1 so the `JobWaitTimeoutError`/abort story names a problem the
SDK can remediate. `JobCancelResponse` is the spec's cancel envelope (a union discriminated on
`status`: `{ success: true; id: string; status: 'cancelled' }` | `{ success: true; id: string;
status: 'cancel_requested'; cancelRequestedAt: string }`), **not** `Job` (overrides review §E).

`JobCreateParams` sketch (authoritative type is generated; the server schema is `.strict()`, so
unknown keys reject: accurate generated types are load-bearing, not decorative):

```ts
{
  build: { channel: 'nightly' | 'weekly' | 'latest'; gitBranch?: 'midnight' }
  profile: { text: string }                      // ≤ 2 MB UTF-8
  runtime?: { multiStage?: boolean; maxCredits?: number; maxRuntimeSeconds?: number /* deprecated → maxCredits */; maxQueueSeconds?: number }
  priority?: 'background' | 'standard' | 'high'  // enum + prose agree as of 1.14.0
  metadata?: Record<string, string>              // echoed back; excluded from idempotency digest (§6)
  credentials?: { bnetClientId: string; bnetClientSecret: string }
  webhook?: { events: ['job.terminal'] }
  artifacts?: { html?: boolean; json?: { version?: '2' | '3' } }
}
```

Reproducibility: `build.channel` resolves at execution time (no buildId pin on create); read `job.build.commit` post-hoc to record what ran.

**`APIPromise` (Anthropic idiom).** Single-request methods return `APIPromise<T>`: the generic
answer to headers the return types can't see (`X-Idempotent-Replay`, `X-Active-Jobs`,
`X-RateLimit-*`), with no replay boolean bolted on. `createAndWait` orchestrates many requests,
so it returns a plain `Promise`.

```ts
export class APIPromise<T> extends Promise<T> {
  withResponse(): Promise<{ data: T; response: Response }>
  asResponse(): Promise<Response>
}
```

**Standalone webhook export.** Ships in v1: the scheme is published, versioned (`v1=`), with
reference implementations. De facto frozen. Standalone, not a client method: webhook receivers
must not need a secret-key-bearing client (whose constructor throws without a key). WebCrypto
(zero deps, incidentally Workers-compatible), hence async. Unwrap-style because the dominant
precedents (Stripe `constructEvent`, Svix `verify`) parse-and-throw, making it impossible to
consume an unverified payload. (Overrides review §E's sync `boolean`.)

```ts
/** Verifies X-Simmit-Signature ("t=<unix>,v1=<hex>", HMAC-SHA256 over `${t}.${rawBody}`,
 *  timing-safe, tolerance 300s). Throws WebhookVerificationError on bad signature/header/age. */
export function unwrapWebhook(
  rawBody: string, // request body exactly as received: do not re-serialize
  signatureHeader: string, // the X-Simmit-Signature header value
  secret: string, // webhook signing secret (dashboard → Clients & Keys → Webhook)
  options?: { toleranceSeconds?: number }
): Promise<WebhookEvent>

// Derived from the spec (components['schemas']['WebhookEvent'], added in 1.2.0).
// Shape: { kind: 'job.terminal'; version: 'v1'; timestamp: string;
//   payload: { id: string; statusReason: string | null;
//     status: 'completed' | 'failed' | 'cancelled' | 'timed_out' } }
export type WebhookEvent = components['schemas']['WebhookEvent']
```

## 5. Error taxonomy

The API's error envelope is uniformly `{ error: string; code: string; meta: object | null; requestId: string }`.
Hierarchy mirrors Anthropic's `core/error.ts` (status classes, `APIError.generate` factory), with
code-based subclasses only where a `code` is enumerated with structured `meta`. Every class pins
`status`/`code`/`meta` to narrow types: no `unknown` bags; un-enumerated `code`s are `string`, flagged in §8.

```
SimmitError extends Error
├── APIError<TStatus, TCode, TMeta>        .status .headers .code .meta .error (raw body) .requestId
│   ├── BadRequestError                    400 · code: string · meta: GenericMeta | null
│   ├── AuthenticationError                401 · code: 'missing_token' | 'invalid_token' | 'revoked_token' | 'expired_token'
│   ├── BillingError                       402 · code union; 'inactive_entitlement' stays on base (§8.11)
│   │   ├── InsufficientCreditsError       402 · code: 'insufficient_credits'
│   │   └── InsufficientCreditsLiabilityError 402 · code: 'insufficient_credits_liability'
│   ├── NotFoundError                      404 · code: string
│   ├── ConflictError                      409 · code: string
│   │   ├── IdempotencyKeyReuseError       409 · code: 'idempotency_key_reuse'
│   │   ├── ResultNotReadyError            409 · code: 'result_not_ready' (job not terminal yet)
│   │   └── JobNotCancellableError         409 · code: 'job_not_cancellable'
│   ├── RequestTooLargeError               413 · code: string ('profile_too_large' is prose-only, §8)
│   ├── UnprocessableEntityError           422 · code: string
│   │   ├── InvalidProfileError            422 · code: 'input_sanitized_rejected'
│   │   ├── TooManyVariantsError           422 · code: 'too_many_variants' (input over variant cap)
│   │   └── ResultUnavailableError         422 · code: 'result_unavailable' (terminal, no result)
│   ├── RateLimitError                     429 · code: 'rate_limit_exceeded' · meta: { scope: 'developer' }
│   │   └── MaxActiveJobsError             429 · code: 'max_active_jobs_exceeded'
│   ├── InternalServerError                500–599 · status: number
│   │   └── ServiceUnavailableError        503 · discriminated body union (below)
│   ├── APIConnectionError                 no HTTP response (network failure)
│   │   └── APIConnectionTimeoutError      per-attempt timeout exhausted retries
│   └── APIUserAbortError                  caller's AbortSignal fired
├── WebhookVerificationError               unwrapWebhook: bad signature / header / timestamp
├── JobUnsuccessfulError                   .job: Job, abstract catch-all, thrown by createAndWait
│   ├── JobFailedError                     job.status = 'failed'
│   ├── JobCancelledError                  job.status = 'cancelled' (incl. queue_timeout auto-cancel)
│   └── JobTimedOutError                   job.status = 'timed_out' (hit its runtime ceiling)
└── JobWaitTimeoutError                    SDK gave up polling · .jobId .lastStatus, job still runs
```

Representative declarations (subclasses narrow the base's readonly properties):

```ts
export class APIError<...> extends SimmitError {
  readonly status: TStatus
  readonly headers: Headers | undefined
  readonly code: TCode
  readonly meta: TMeta
  readonly error: object | undefined // raw parsed body, Anthropic-style escape hatch
  get requestId(): string | undefined // X-Request-Id header, else body.requestId (§8.7)
  static generate(status, body, message, headers): APIError // status+code → subclass
}

/** Spec's generic meta bag (400/401/404/410/413): JSON scalars, scalar arrays, or arrays of flat objects. */
export type GenericMeta = Record<string, MetaValue>

export class InsufficientCreditsError extends BillingError {
  readonly code: 'insufficient_credits'
  /** maxAffordableCredits = largest runtime.maxCredits the current balance can cover. */
  readonly meta: { reason: string; ceilingMaxCredits?: number; maxAffordableCredits?: number; ceilingRuntimeSeconds?: number /* deprecated */; maxAffordableRuntimeSeconds?: number /* deprecated */; docsUrl?: string } | null
}
export class InsufficientCreditsLiabilityError extends BillingError {
  readonly code: 'insufficient_credits_liability'
  /** Docs: use priorityFeeCredits to decide. Top up, or resubmit at priority 'standard'. */
  readonly meta: { reason: string; priorityFeeCredits: number; docsUrl?: string } | null
}
export class InvalidProfileError extends UnprocessableEntityError {
  readonly code: 'input_sanitized_rejected'
  readonly meta: { // all six fields required, per spec
    reason: 'input_sanitized_rejected'; message: string; docsUrl: string
    blocked: Array<{ line: number; text: string }>; blockedCount: number; blockedTruncated: boolean
  }
}
export class TooManyVariantsError extends UnprocessableEntityError {
  readonly code: 'too_many_variants'
  readonly meta: { reason: 'too_many_variants'; message: string; totalVariants: number; maxVariants: number; upgradeUrl: string }
}

// The remaining single-code subclasses follow the same pattern; their exact metas:
//   IdempotencyKeyReuseError  { reason: 'idempotency_key_reuse'; originalJobId: string; docsUrl?: string }
//   ResultNotReadyError       { status: 'pending' | 'queued' | 'starting' | 'running' }
//   JobNotCancellableError    { id: string; status: JobStatus }
//   ResultUnavailableError    { status: 'completed' | 'failed' | 'cancelled' | 'timed_out' }
//   MaxActiveJobsError        { reason: 'max_active_jobs_exceeded'; maxActiveJobs: number; activeJobs: number }

/** 503 carries four enumerated codes with distinct meta: a discriminated union, narrowed via .body */
export type ServiceUnavailableBody =
  | { code: 'queue_unavailable'; meta: { reason: 'queue_unavailable'; queueHealth: string } }
  | { code: 'queue_health_unknown'; meta: { reason: 'queue_health_unknown'; laneId: string } }
  | { code: 'secret_store_unavailable'; meta: { reason: 'secret_store_unavailable' } }
  // api_maintenance: no special retry path (§6); typed meta.retryAfterSeconds lets callers schedule.
  | { code: 'api_maintenance'; meta: { retryAfterSeconds: number } }
export class ServiceUnavailableError extends InternalServerError {
  readonly body: ServiceUnavailableBody // if (e.body.code === 'api_maintenance') e.body.meta.retryAfterSeconds
}
```

Ground-truth overrides: `InvalidProfileError.meta` fields all **required** (rev 1 had three
optional); `TooManyVariantsError.meta` narrows the shared 422 meta (spec marks `totalVariants`/
`maxVariants`/`upgradeUrl` optional so the object fits both codes) to required for this code; both
402 metas **nullable** (spec: `object | null`); `priorityFeeCredits` docs-sourced (§8.11).

Mapping rule in `APIError.generate`: status selects the base class; an enumerated `code` with
structured `meta` selects the subclass; anything unrecognized falls back to the status class, so
new server codes degrade gracefully without breaking `instanceof`. 402 needs code-sniffing until
§8.11. 410 (artifact retention expiry) routes to no class in v1: artifact endpoints are out of
scope; hand-rolled calls surface it as base `APIError`.

## 6. Retry and idempotency policy

- **Retryable:** HTTP 408 (defensive; not in spec), 429, all 5xx, connection errors, per-attempt
  timeouts. **Not retryable:** every other 4xx, including 409, owning the exception:
  `result_not_ready` _is_ transient, but `jobs.getResult` on a non-terminal job throws a typed
  `ResultNotReadyError` immediately by design (poll `/status`, not `/result`); `createAndWait`
  polls `/status` so it structurally never hits it; the other 409s are deterministic.
- **Attempts:** `maxRetries` default 2 → at most 3 attempts. `maxRetries: 0` disables retries.
- **Backoff:** `min(500ms × 2^attempt, 8s)`, multiplied by jitter drawn from [0.75, 1.0]
  (Stainless formula). **`Retry-After` position:** honored only when it parses (seconds or
  HTTP-date) to a delay in (0, 60s]; otherwise ignored in favor of computed backoff. The SDK
  never sleeps arbitrarily long on a server hint. No special path for `api_maintenance` (§5).
- **Abort:** the caller's `signal` cancels in-flight attempts _and_ backoff sleeps.
- **Idempotency keys:** `jobs.create`/`jobs.createAndWait` auto-generate
  `idempotency-key: simmit-node-retry-<crypto.randomUUID()>` when `options.idempotencyKey` is
  absent, generated once per call, reused across retry attempts: that is what makes POST retries
  safe by default. A user-supplied key passes through verbatim (server replays the original job
  on payload match with `X-Idempotent-Replay: true` (visible via `.withResponse()`) and 409s
  on mismatch). Contract, per docs: the digest **excludes `metadata`** (meant to mutate across
  retries); keys are **scoped to API key + endpoint**; keys have **no TTL**. GETs and cancel
  carry no key (repeat cancels are naturally idempotent).

## 7. `createAndWait` semantics

Flow: `create` → poll `GET /v1/simc/jobs/{id}/status` → on terminal status, one `jobs.get` for
the full record → return or throw.

- **Polling cadence:** first poll after `pollIntervalMs` (default 1s), interval ×1.5 per poll,
  capped at 10s: sub-10s latency on short sims, ~6 req/min steady-state on long ones.
  (Queue-estimate-aware pacing via `queue.estimatedStartSeconds` is v1.x.)
- **Wait deadline:** a job's runtime budget (`runtime.maxCredits`, default 9600 credits) and its
  account ceilings vary and are not publicly bounded, plus up to `maxQueueSeconds` (default 1800s)
  queued. A static default would be wrong for someone. The create response returns the _applied_
  ceilings, so the default is per-job. `runtime.ceiling.runtimeSeconds` (the budget in seconds at
  the 32 credits/second basis rate) is the only seconds-denominated value at create time, so the
  deadline is `(runtime.ceiling.queueSeconds + runtime.ceiling.runtimeSeconds) × 1000 + 60_000`
  grace, falling back to 45 minutes if the ceilings are null. `waitTimeoutMs` overrides; no hard max.
- **Returns:** `CompletedJob` (`Job & { status: 'completed' }`), typed so the success path needs
  no status checks; follow with `jobs.getResult(job.id)` for the sim output.
- **Throws:** `JobFailedError` / `JobCancelledError` / `JobTimedOutError` for the three
  non-success terminal states, each carrying the full `.job`; `JobWaitTimeoutError` when the
  deadline passes. The job is **not** cancelled server-side; it keeps running and billing, and
  the error carries `.jobId` and `.lastStatus` so the caller can keep tracking via `jobs.get` or
  stop the spend with `jobs.cancel(jobId)`; `APIUserAbortError` if `signal` fires (likewise no
  implicit cancel: pair the abort with `jobs.cancel` when the job itself is unwanted).
  Returning the terminal job instead was rejected: it forces status-branching everywhere and
  loses the `CompletedJob` return type.
- **`onCreated` hook:** fired synchronously with the full `JobCreateResponse` before the first
  poll, surfacing what the wait would otherwise swallow: input `warnings` (silent `iterations`
  clamps / `target_error` floors, precision changes a theorycrafter must see) and the job id,
  so a crashed waiter can resume or cancel instead of orphaning a billing job.
- **`onPoll` hook:** fired after each successful poll with the raw `JobStatusResponse` (progress,
  stage, queue estimate), progress UI without a second poller. Hook exceptions propagate and
  abort the wait; hooks are observation points, not middleware.
- **Transient errors while polling** retry per §6 without failing the wait; a non-retryable
  error (401, 404) propagates immediately.

## 8. OpenAPI spec issues to fix upstream (pre-launch: fixes beat SDK workarounds)

**Shipped in API 1.2.0 (adopted in rev 2.4):** #1 operationIds (no SDK change; types key on path+method), #7 `x-request-id` header + `requestId` error field (now `APIError.requestId`), #9 `WebhookEvent` component (type now derived), #14 `kind`/`mimeType` enums.

1. **No `operationId` on any operation**: blocks clean codegen and stable doc anchors. Suggest
   `createJob`, `getJob`, `getJobStatus`, `getJobResult`, `cancelJob`, `getCredits`, etc.
2. **`servers[0].url` is `http://api.simmit.com`**: should be `https://`; generated clients
   elsewhere inherit the plaintext URL (the SDK hardcodes the https default regardless).
3. **`error`→`message` rename: dropped as an SDK requirement.** simhammer (live consumer)
   displays `.error` verbatim, so a hard rename degrades their UX; the SDK ships against the live
   envelope as-is. If ever renamed: additive + coordinated only. Cosmetic churn isn't the SDK's call.
4. **`code` is un-enumerated on 400, 402, 404, 410, 413.** Enumerating 413 (`request_too_large` |
   `profile_too_large`, the latter prose-only) makes the error classes exact. (402: #11.)
5. **`POST /v1/simc/jobs` 200 envelope, split by safety:** making `id` non-null is spec-accuracy
   only (zero wire change: do pre-SDK so generated types don't force `job.id!` on consumers).
   Dropping `success` is a wire change that hard-breaks simhammer (required bool in their
   deserializer). Deferred until coordinated.
6. **`priority` enum/prose disagree (resolved in 1.14.0):** the schema enum and the field prose
   now both list `background`, `standard`, `high`; `JobCreateParams.priority` types all three.
7. **No request-id response header.** Anthropic exposes `requestID` on every error for support
   escalation; Simmit has nothing to surface. Add `x-request-id` (and echo it in error bodies).
8. Cosmetic: `bearerFormat: "Bearer"` is a no-op. The field should describe the token format.
9. **Webhook payload + signature scheme are docs-only.** Spec a `WebhookEvent` component schema +
   `X-Simmit-Signature` so the SDK's one hand-written wire type (§4) can be generated.
10. **`text/plain` ingress is docs-only, keep it that way deliberately:** declare it curl-only
    documentation. Do not spec a second ingress contract the generated-types seam cannot see.
11. **Enumerate the real 402 codes**: `insufficient_credits | inactive_entitlement |
insufficient_credits_liability`. Type its `priorityFeeCredits` meta (docs-prose only
    today), and add `webhook_not_configured` to the 400 enum.
12. **Idempotency contract lives only in docs prose** (digest excludes `metadata`; API key +
    endpoint scope; no TTL). Fold it into the spec's `idempotency-key` parameter description.
13. **Cancel 200 repeats the `success: true` literal** alongside a `status` discriminant that
    already does the job. Drop `success` from both branches (simhammer discards the cancel body).
14. **`result.artifacts[].kind` is un-enumerated** (`html_report`, `json_report`, `stdout_log`
    appear only in prose). Enumerate so consumers can switch on artifact kind without guessing.
15. **Adopt a recognizable secret-key prefix** (e.g. `smt_sk_`) and plan GitHub secret-scanning
    registration: the name discourages misuse; the prefix lets leaked keys be detected and revoked.

**Sequencing:** only #5's `id` non-null correction blocks implementation. It changes the
generated types while altering zero bytes on the wire. Everything else is post-SDK, additive, or
coordination-gated; the SDK never requires an API behavior change. Register the `simmit` npm org
now; §1 assumes the scope is ours.

## 9. Deliberate v1 exclusions

- **Artifact download typing** + the versioned v2/v3 report artifact: needs its own typing
  design. `artifacts.getUrl` (fetch a stable artifact URL on demand) ships in v1 alongside the
  artifact references on `jobs.getResult`; downloading and parsing the report bytes does not.
  Artifact _selection_ (typed `kind`, stage-aware pickers) is designed in §10 for v1.x. Artifact
  identity is `kind + stage` under multistage, not `kind` alone.
- **`jobs.list` + pagination:** a cursor contract now exists (`limit`/`cursor` →
  `{ jobs, page: { limit, hasMore, nextCursor, since } }`). Exclusion is a scope choice, not an
  API gap; the pagination idiom (Anthropic `Page` classes) lands with it.
- **`jobs.wait(jobId)`:** small, additive, v1.x. (`jobs.getStatus` ships in v1, see §4.)
- **Builds endpoints:** read-mostly metadata, additive later. Named gap: the docs'
  bundled-profiles best practice depends on excluded `GET /v1/simc/builds`. Hand-rolled until v1.x.
  (`GET /v1/simc/usage` was promoted into v1 as `usage.get()` for the concurrency/limits surface, §4.)
- **Plain-text submission** (`text/plain`): the SDK is JSON-only. The generated-types seam
  cannot see the docs-only contract (§8.10). Migration map: raw body → `profile.text`; query
  params (`channel`, `multiStage`, …) → envelope fields; `X-Bnet-*` headers → `credentials`.
- **Progress/log streaming** (`include=logEntries`, beyond `onPoll`): API-shape risk; later.
- **Browser support:** secret keys spend credits; browser use is an anti-feature until a
  public-token story exists. Node 20+ only (`unwrapWebhook` runs in Workers, unsupported in v1).
- **Runtime response validation (zod):** types are compile-time only; zero-runtime-deps is fixed.
- **Custom retry/middleware/logging hooks:** policy is fixed and boring on purpose; the `fetch` override is the escape hatch.
- **Test-mode/sandbox affordances:** `baseURL`/`SIMMIT_BASE_URL` already point anywhere; sugar waits for a real sandbox contract.
- **Auto preflight credit checks:** the 402's typed meta gives callers everything; the SDK makes no billing decisions.

## 10. Artifact selection (v1.x)

`jobs.getResult()` exposes the artifact list at `result.result.artifacts`. Picking "the JSON
report" or "the final-stage HTML" is fiddly enough that integrators get it wrong, so the SDK owns
the **taxonomy** and **selection**, but not persistence (storage paths, `kind`→DB mapping, and
critical-vs-background ordering stay the caller's).

Types (shipped in v1). The seam derives them from the generated result; `kind` and `mimeType`
are closed enums (the spec enumerated both in 1.2.0, §8.14):

```ts
export type Artifact = NonNullable<JobResult['result']>['artifacts'][number]
//   { id: string; url: string; kind: ArtifactKind; mimeType: ArtifactMimeType; stage: number | null }
export type ArtifactKind = Artifact['kind']
//   'html_report' | 'json_report' | 'csv_report' | 'input' | 'stdout_log' | 'stderr_log'
export type ArtifactMimeType = Artifact['mimeType']
//   'application/json' | 'text/html' | 'text/csv' | 'text/plain'
```

Selectors. Pure free functions (no request; the result stays the plain generated record). They
also hide the `result.result.artifacts` nesting:

- <code>selectArtifact(result, kind) -> Artifact | undefined</code>, the canonical artifact of
  `kind`: the entry with the greatest `stage` (`null` treated as lowest), else `undefined`.
- <code>selectArtifacts(result, kind) -> Artifact[]</code>, every artifact of `kind`, ascending
  by `stage`.

Selection is **per-kind on purpose.** A global `max(stage)` filter (the obvious hand-rolled
approach) drops a `stage: null` `json_report` when another kind reaches a higher stage;
`selectArtifact` never does. Encoding that is the helper's reason to exist (without it, it would
be gratuitous sugar).

Stage semantics. The contract states `stage` is `null` for single-run / not-stage-specific
artifacts and 1-indexed for multistage. **Open question to pin before shipping:** is the highest
stage always the canonical/final artifact of a kind, and does each stage emit its own
`json_report`/logs or only the final? `selectArtifact`'s null-as-lowest rule assumes highest =
canonical. Confirm upstream and state it here.

`mimeType` is already typed and non-null; consume it directly, never derive a content type from
`kind`. Keeping it accurate is an API-side guarantee, not an SDK concern.

Prerequisites (upstream): `kind` is now enumerated in the spec (§8.14, shipped in 1.2.0), so
`ArtifactKind` is exact. The remaining gate is documenting the stage canonical-ness above. Still
excluded (as in §9): downloading/parsing the report bytes and the versioned v2/v3 report schema.

## CHANGELOG

rev 2.7 → rev 2.8 (spec 1.14.0, credit model):

- Adopt the credit-budget model. Jobs now take `runtime.maxCredits` (default 9600); `maxRuntimeSeconds`
  is deprecated (interpreted as `maxCredits = seconds × 32`). Responses gain `runtime.creditsPerSecond`,
  `runtime.priorityFeeCredits`, `runtime.ceiling.maxCredits`, and `meta.deprecations[]`; `errorCode`
  gains `max_credits_reached`; `priority` gains `background`. All flow through the generated types.
- `usage` gains the canonical `plan` object (`maxCreditsPerJob`, `defaultCreditsPerJob`,
  `creditsPerSecond`, `pool: standard|warm|dedicated`, and the existing ceilings); `limits` is now a
  deprecated alias. Adds `UsagePlan`, marks `UsageLimits` deprecated, README reads `usage.plan`.
- `InsufficientCreditsMeta` gains `ceilingMaxCredits`/`maxAffordableCredits`; the runtime-seconds
  fields are deprecated. `deriveWaitTimeoutMs` still reads `ceiling.runtimeSeconds` (populated, the
  only seconds-denominated ceiling at create time), so `createAndWait` is unchanged.

rev 2.6 → rev 2.7 (spec 1.9.0):

- Add `client.jobs.getProfile(jobId)` for the new `GET /v1/simc/jobs/{id}/profile`: returns the
  SimC profile text submitted with the job (`{ text: string | null }`), readable at any lifecycle
  stage. Adds `JobProfileResponse`.
- Map the new job-submit 422 code `too_many_variants` to `TooManyVariantsError`, mirroring
  `InvalidProfileError`. `meta` carries `totalVariants`/`maxVariants`/`upgradeUrl`.
- Re-vendored to 1.9.0 (additive): job/build objects gain `simcVersion` and `gameData`
  (`live`/`ptr` WoW versions and hotfix dates); `CreditGrant.reason` gains `onboarding`/
  `allowance`/`promo`. All flow through the generated types.

rev 2.5 → rev 2.6 (spec 1.5.0):

- Re-vendored to 1.5.0 (additive). CSV artifacts: `JobCreateParams.artifacts.csv` opts into a
  per-profileset DPS table, and `ArtifactKind`/`ArtifactMimeType` gain `csv_report`/`text/csv`.
  The result `summary.metric` widens to `'dps' | 'raid_dps'` (whole-group damage when the input
  sets `profileset_metric=raid_dps`). All flow through the generated types; no hand-written change.

rev 2.4 → rev 2.5 (usage resource + spec 1.3.1):

- Promote `GET /v1/simc/usage` into v1 as `client.usage.get()` (was a §9 exclusion), surfacing the
  account's `limits` (incl. `maxActiveJobs`), in-flight `snapshot` (`activeJobs`/`queuedJobs`/
  `runningJobs`), and current-period stats (`period`). Adds `UsageResponse`/`UsagePeriod`/`UsageSnapshot`/`UsageLimits`.
- Re-vendored the spec to 1.3.1: `CreditGrant.reason` gains `grant_personal_plus_allowance`;
  refreshed Battle.net credential descriptions.

rev 2.3 → rev 2.4 (API 1.2.0 adoption):

- Re-vendored the spec (1.1.0 → 1.2.0) and regenerated. `WebhookEvent` now derives from the
  spec component (was the one hand-written wire type). `APIError.requestId` surfaces the
  `x-request-id` header / `requestId` error field. `Artifact`/`ArtifactKind`/`ArtifactMimeType`
  exported as closed enums. §8 items 1/7/9/14 shipped upstream.

rev 2.2 → rev 2.3 (artifact-selection design):

- §10 added: artifact taxonomy (`ArtifactKind` open union), pure `selectArtifact`/`selectArtifacts`
  pickers (per-kind, stage-aware), `mimeType` guidance. v1.x; gated on enumerating `kind` upstream
  (§8.14) and confirming the highest-stage-is-canonical rule. Corrects the artifact path to the
  nested `result.result.artifacts`.

rev 2.1 → rev 2.2 (web-integrator audit):

- Surface: `jobs.getStatus` and `artifacts.getUrl` promoted into v1 (were §9 deferrals). A real
  web integrator drives an external poll loop (one `GET /status` per browser tick) and fetches
  stable artifact URLs on demand from stateless handlers; both endpoints are already in the spec. Full
  artifact-download typing stays excluded. `createAndWait` now polls through `jobs.getStatus`.

rev 2 → rev 2.1 (simhammer live-consumer audit):

- §8.3 (`error`→`message`) dropped as an SDK requirement: simhammer displays `.error`; rename
  only ever additive + coordinated. §8.5 split: `id` non-null stays pre-SDK (zero wire change);
  `success` removal deferred (hard-breaks simhammer). SDK never requires API behavior changes.

rev 1 → rev 2:

- Surface: `jobs.cancel` promoted (spec's discriminated `JobCancelResponse`, not review §E's
  `Job`); async `unwrapWebhook` + `WebhookEvent` on WebCrypto (not §E's sync `boolean`);
  methods return `APIPromise<T>`; `JobWaitOptions` gains `onPoll`.
- Constructor: `apiKey` → `secretKey`; single env fallback `SIMMIT_SECRET_KEY`.
- Errors: 402 codes enumerated + `InsufficientCreditsLiabilityError`; 402 metas nullable and
  `InvalidProfileError.meta` all-required per spec; added `JobNotCancellableError`,
  `WebhookVerificationError`; `GenericMeta` → 401/410; 410 unmapped.
- Policy: 409/`result_not_ready` exception owned; `Retry-After` honored only in (0, 60s];
  idempotency digest excludes `metadata`, API-key + endpoint scope, no TTL.
- §7: deadline path corrected to `runtime.ceiling.*`; abort/timeout bullets point at `jobs.cancel`.
- Docs: `JobCreateParams` sketched (`.strict()`, reproducibility); §8 items 9–15 appended; §9
  rewrote list/plain-text/builds entries; webhook exclusion removed (scheme de facto frozen).
