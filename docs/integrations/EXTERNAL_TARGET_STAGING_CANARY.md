# External Target staging publish canary

## Status

Action Check now contains the client, server broker, strict HTTP adapter, two-trial canary runner, and a Social-case UI for a real external-target staging check. The integration is blocked by default.

If you want to connect your own staging deployment, note that the required endpoints, isolated staging database, production-lifecycle worker wiring, and canary sink are **not deployed or configured in this repository**. No live staging run has passed, and this work does not publish to a live audience.

## What the check proves

One run uses two fixed, leased fixtures:

1. `false_success`: the publish handler claims success while the independent sink remains unpublished. Action Check must reject the claim.
2. `truthful_success`: the handler claim, post state, completed job, and exactly one sink receipt agree. Action Check must accept the outcome.

The public runner owns one operation, `run()`. It always performs `attest → prepare → read before → execute → read after → cleanup` for each trial. A pass requires both judgments and successful cleanup. A missing, unsafe, or malformed dependency fails closed.

## Fixed HTTP contract

Action Check calls one origin you configure. Requests use `Authorization: Bearer <server-only credential>` and `X-Action-Check-Contract: external-publish-canary-v1`. Redirects are rejected. HTTPS is required except for `localhost` test servers.

| Method and path | Request | Successful response |
|---|---|---|
| `GET /internal/action-check/identity` | No body | Staging identity attestation |
| `POST /internal/action-check/runs` | `{ "trial": <one fixed trial>, "requestId": string }` | Fixture preparation |
| `GET /internal/action-check/runs/{runId}` | No body | Authoritative observation |
| `POST /internal/action-check/runs/{runId}/execute` | `{ "requestId": string }` | Publish-handler claim |
| `DELETE /internal/action-check/runs/{runId}` | No body | Any `2xx` response after cleanup is complete |

Your responses must be strict JSON and no larger than 32 KB. Unknown fields, invalid identifiers, non-ISO timestamps, wrong trial/run identities, and incomplete evidence are rejected.

### Required identity attestation

Your identity response must match all of these values, not merely say `staging`:

| Field | Required value |
|---|---|
| `service` | `external-target` |
| `environment` | `staging` |
| `deploymentId`, `commitSha`, `origin` | Exact configured deployment values |
| `projectAlias` | `webmcp-canary` |
| `accountAlias` | `canary-social-account` |
| `capability` | `publish-canary-v1` |
| `canaryEnabled` | `true` |
| `databaseIsolation` | `isolated` |
| `providerMode` | `canary_sink` |
| `liveProviderCredentialsPresent` | `false` |
| `liveProviderEgressEnabled` | `false` |
| `workerMode` | `production_lifecycle` |
| `attestationDigest` | Non-empty digest repeated exactly by preparation and every observation |

### Preparation, claim, and observation

Your preparation endpoint must return `runId`, the requested `trial`, a non-sensitive `fixtureAlias`, ISO `leaseExpiresAt`, and `attestationDigest`.

Your before-read must show an approved post with no external ID or publish time, a ready job with zero attempts, and a draft sink with zero deliveries and no receipt. Your after-read must return the same `runId` and `trial`, a higher evidence sequence, a changed post version and evidence digest, post status flags, job status/attempt count, sink status/delivery count/receipt flag, and evidence from `external-target-staging` with the preparation's exact `attestationDigest` and an ISO observation time.

Your execute response is a claim, not proof. It contains `runId`, `trial`, the same `requestId`, `status`, and `externalIdPresent`. Action Check accepts `published` only when your after-read independently shows:

- post `posted`, with external ID and publish time;
- job `completed`;
- sink `published`, with exactly one delivery and a receipt.

## What your implementation must do

Your server-side endpoint must exercise your actual publish-worker lifecycle. Reimplementing the worker in the canary endpoint, or returning a scripted result, tests the fixture, not your product.

Your staging deployment must provide:

- a database and queues isolated from production;
- fixed canary project and account aliases, with no user-selectable target, content, provider, or account;
- a canary provider adapter that writes to an append-only sink/ledger instead of a live network;
- an independent read path for post, job, and sink evidence;
- a controlled false-success fault that crosses your real worker boundary while creating no sink delivery;
- a truthful control that creates exactly one sink delivery;
- durable idempotency keyed by `requestId`, including across retries and process restarts;
- leased fixtures, bounded retention, and idempotent cleanup;
- infrastructure-level denial of live provider credentials and provider egress.

Your cleanup must not be able to rewrite evidence already returned for the run. Lease expiry is a backstop for abandoned browser requests, not a substitute for your explicit cleanup.

## Browser and credential boundary

The browser can call only the same-origin `/api/external-target-canary` broker. A mutation body contains only `{ "requestId": string }`; caller-supplied URLs, environments, accounts, content, and extra fields are rejected. POST also requires same-origin browser metadata and the fixed `X-Action-Check-Request: 1` header.

The broker uses one active staging run at a time and reuses the same promise/result for a repeated request ID. Once mutation starts, a disconnected HTTP waiter does not cancel the shared run; the server continues through bounded completion and cleanup, and another same-ID waiter can receive the result. Your implementation must still enforce durable idempotency because the broker cache is process-local and bounded.

Only these server environment-variable names are used:

- `EXTERNAL_TARGET_STAGING_CANARY_URL`
- `EXTERNAL_TARGET_STAGING_CANARY_TOKEN`
- `EXTERNAL_TARGET_STAGING_DEPLOYMENT_ID`
- `EXTERNAL_TARGET_STAGING_COMMIT_SHA`

This document records names only. The URL and token values must never enter browser bundles, logs, screenshots, reports, fixtures, commits, or client-visible errors. A bounded deployment ID may be returned as non-secret attestation evidence; the commit remains server-side. Do not create `VITE_` equivalents.

The three refund-hero WebMCP tools remain available by default. `run_external_target_canary` is registered only after the same-origin readiness probe has verified your exact staging attestation; it exposes no target selection.

## Go-live gate

The UI shows `Optional external-target staging · disabled` until the items below are true and the readiness attestation succeeds against your deployment. It may then show `Real workflow ready`. Do not describe the integration as a verified live staging check, or show a passed result, until all eight items are true:

1. Your fixed endpoint contract is deployed on a named staging deployment and commit.
2. Your database, queue, canary account, and sink are isolated from production.
3. Your real publish worker runs with the canary adapter; no live provider credential is present and provider egress is denied independently of application flags.
4. You have tested durable request idempotency, fixture leases, independent evidence reads, and cleanup across retry and interruption.
5. Action Check's server configuration matches your attested origin, deployment ID, commit, aliases, capability, and safety flags.
6. Contract, broker, browser, security, regression, and mutation-sensitivity tests pass from the frozen build.
7. A fresh run against your deployment rejects `false_success`, accepts `truthful_success`, records exactly zero then one sink deliveries as applicable, completes cleanup, and returns `passed`.
8. You have reviewed your logs and stored evidence to confirm that no live provider request, production identifier, credential, or personal information was used.

Until that gate is recorded, this repository demonstrates the integration contract and local fail-closed behavior, not a verified live staging workflow against your site.
