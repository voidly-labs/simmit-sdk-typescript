// Manual pre-release smoke check: runs the built SDK against a real Simmit API
// to confirm the wire format and error mapping still match the types. Not part
// of the automated suite — it needs a secret key, and the full run spends a
// little credit. Run via `pnpm smoke` (builds first, then executes):
//
//   SIMMIT_SECRET_KEY=smt_sk_... pnpm smoke
//   SIMMIT_SECRET_KEY=... SIMMIT_PROFILE_FILE=./my.simc pnpm smoke   # also create -> result
//
// TEST_API_BASE_URL targets a non-prod endpoint (mirrors anthropic-sdk-typescript);
// otherwise the client's normal default (SIMMIT_BASE_URL ?? production) applies.
import { readFileSync } from 'node:fs'
import Simmit, { NotFoundError, SimmitError } from '../dist/index.js'

const baseURL = process.env.TEST_API_BASE_URL
const client = new Simmit(baseURL ? { baseURL } : {})

// 1) Auth + a real GET + the CreditBalance shape.
const credits = await client.credits.get()
console.log('✓ credits.get →', JSON.stringify(credits))

// 2) Error mapping on a real 4xx: a nonexistent job should map to NotFoundError.
try {
  await client.jobs.get('000000000000000000')
  console.error('✗ expected a NotFoundError but the call succeeded')
  process.exitCode = 1
} catch (err) {
  if (err instanceof NotFoundError) {
    console.log(
      `✓ error mapping → NotFoundError status=${err.status} code=${err.code}`
    )
  } else if (err instanceof SimmitError) {
    console.log(`• mapped to ${err.constructor.name} (expected NotFoundError)`)
  } else {
    throw err
  }
}

// 3) Full lifecycle (spends credit, needs a real profile). Opt-in.
const profileFile = process.env.SIMMIT_PROFILE_FILE
if (!profileFile) {
  console.log(
    '— set SIMMIT_PROFILE_FILE=./your.simc to also exercise create → result'
  )
  process.exit()
}

const text = readFileSync(profileFile, 'utf8')
const job = await client.jobs.createAndWait(
  { build: { channel: 'latest' }, profile: { text } },
  {
    waitTimeoutMs: 15 * 60 * 1000,
    onCreated: (r) =>
      console.log('  created', r.id, '| warnings:', r.warnings ?? 'none'),
    onPoll: (s) => console.log('  poll →', s.status, s.progress?.percent ?? '')
  }
)
console.log('✓ createAndWait → completed', job.id)

// Dump the result to confirm the live shape matches JobResult — notably the
// nested result.summary.mainActor (+ optional profilesets) and result.artifacts[].
const result = await client.jobs.getResult(job.id)
console.log('✓ getResult → confirm this matches the JobResult type:')
console.log(JSON.stringify(result, null, 2).slice(0, 4000))

const artifact = result.result?.artifacts?.[0]
if (artifact?.id) {
  const fresh = await client.artifacts.getUrl(artifact.id)
  console.log('✓ artifacts.getUrl →', fresh.url)
}
