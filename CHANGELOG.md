# Changelog

## [0.8.0](https://github.com/voidly-labs/simmit-sdk-typescript/compare/v0.7.0...v0.8.0) (2026-07-21)


### Features

* adopt spec 1.14.0 credit model (maxCredits, usage.plan) ([#58](https://github.com/voidly-labs/simmit-sdk-typescript/issues/58)) ([6ec6768](https://github.com/voidly-labs/simmit-sdk-typescript/commit/6ec676821061e2cf4e956452eee16d8ec6634c61))

## [0.7.0](https://github.com/voidly-labs/simmit-sdk-typescript/compare/v0.6.0...v0.7.0) (2026-07-15)


### Features

* add jobs.getProfile and map too_many_variants (spec 1.9.0) ([#53](https://github.com/voidly-labs/simmit-sdk-typescript/issues/53)) ([6e0c107](https://github.com/voidly-labs/simmit-sdk-typescript/commit/6e0c1077d3a4724dcd33444e2d3b8ed66caab079))

## [0.6.0](https://github.com/voidly-labs/simmit-sdk-typescript/compare/v0.5.0...v0.6.0) (2026-07-01)


### Features

* adopt spec 1.5.0 (CSV artifacts, raid_dps metric) ([#49](https://github.com/voidly-labs/simmit-sdk-typescript/issues/49)) ([c1f4fa9](https://github.com/voidly-labs/simmit-sdk-typescript/commit/c1f4fa9a1349edc18e611bc93e1c129ab4584220))

## [0.5.0](https://github.com/voidly-labs/simmit-sdk-typescript/compare/v0.4.0...v0.5.0) (2026-06-29)


### Features

* add usage resource (concurrency limits, maxActiveJobs) ([#47](https://github.com/voidly-labs/simmit-sdk-typescript/issues/47)) ([dd88058](https://github.com/voidly-labs/simmit-sdk-typescript/commit/dd880589e22e250dc76b76ea80de843ce661ec81))

## [0.4.0](https://github.com/voidly-labs/simmit-sdk-typescript/compare/v0.3.0...v0.4.0) (2026-06-21)


### Features

* surface queue.queuedAt on the status response ([#44](https://github.com/voidly-labs/simmit-sdk-typescript/issues/44)) ([474d56c](https://github.com/voidly-labs/simmit-sdk-typescript/commit/474d56c63ca914a91d18a2e1031242faea799a34))

## [0.3.0](https://github.com/voidly-labs/simmit-sdk-typescript/compare/v0.2.0...v0.3.0) (2026-06-19)


### Features

* adopt API 1.2.0 spec (requestId, WebhookEvent, artifact enums) ([#42](https://github.com/voidly-labs/simmit-sdk-typescript/issues/42)) ([7615fb4](https://github.com/voidly-labs/simmit-sdk-typescript/commit/7615fb4e4a153f54d38cfc181f21b69d51898f30))

## [0.2.0](https://github.com/voidly-labs/simmit-sdk-typescript/compare/v0.1.1...v0.2.0) (2026-06-18)


### Features

* add isTerminal status guard ([#35](https://github.com/voidly-labs/simmit-sdk-typescript/issues/35)) ([a845e78](https://github.com/voidly-labs/simmit-sdk-typescript/commit/a845e786b21c836476124a129bf02fe66e175082))

## [0.1.1](https://github.com/voidly-labs/simmit-sdk-typescript/compare/v0.1.0...v0.1.1) (2026-06-17)


### Miscellaneous Chores

* drop the one-time release-as ([#33](https://github.com/voidly-labs/simmit-sdk-typescript/issues/33)) ([9c0bc08](https://github.com/voidly-labs/simmit-sdk-typescript/commit/9c0bc0880f90081d5876e9e5c1012b87afc1943e))

## 0.1.0 (2026-06-17)


### Features

* add jobs.getStatus and artifacts.getUrl for decoupled integrations ([#21](https://github.com/voidly-labs/simmit-sdk-typescript/issues/21)) ([32dd56a](https://github.com/voidly-labs/simmit-sdk-typescript/commit/32dd56ad523018cfe4d8ab179e1550ec50792f6d))
* **client:** request core — APIPromise, retries, idempotency, constructor ([#3](https://github.com/voidly-labs/simmit-sdk-typescript/issues/3)) ([5209f72](https://github.com/voidly-labs/simmit-sdk-typescript/commit/5209f7230633711a3b1bf7599b23b233b39e997d))
* **create-and-wait:** poll a submitted job to a terminal state ([#17](https://github.com/voidly-labs/simmit-sdk-typescript/issues/17)) ([3791e4b](https://github.com/voidly-labs/simmit-sdk-typescript/commit/3791e4b2faef7f629d481097e20a0465f3fb972b))
* **errors:** api-types seam and typed error hierarchy ([#2](https://github.com/voidly-labs/simmit-sdk-typescript/issues/2)) ([9f58153](https://github.com/voidly-labs/simmit-sdk-typescript/commit/9f581536fd91ca35dcc5a0f006058c791d375b68))
* **resources:** wire jobs and credits onto the client ([#16](https://github.com/voidly-labs/simmit-sdk-typescript/issues/16)) ([0160949](https://github.com/voidly-labs/simmit-sdk-typescript/commit/016094962f689d3fff55f5b160edfe6e6b793f96))
* **webhook:** standalone unwrapWebhook signature verification ([#18](https://github.com/voidly-labs/simmit-sdk-typescript/issues/18)) ([068e3ee](https://github.com/voidly-labs/simmit-sdk-typescript/commit/068e3eec8c0af740332de05845d7027182746d9e))
