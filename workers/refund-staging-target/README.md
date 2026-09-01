# Refund staging target

This is the independently deployable outcome plane for Action Check's refund-retry demonstration. The browser app invokes it over HTTPS; the target keeps each lane in a separate SQLite-backed Cloudflare Durable Object and exposes a different read path for authoritative observation.

It is staging infrastructure. It never connects to a payment provider or moves real money.

## What it proves

For the same refund request ID:

- the `broken` lane commits again after an acknowledgement is lost, so two invocations create two effect IDs;
- the `protected` lane commits once and then reuses the request ID, so two invocations leave one effect ID;
- `/v1/invoke` returns only the action claim and never returns effect IDs or counts;
- `/v1/observe` reads fresh durable state and returns the sequence, effect IDs, and a SHA-256 evidence digest;
- `/v1/reset` gives both lanes a zero-effect baseline; and
- `/v1/cleanup` deletes both Durable Object stores.

Each run capability accepts at most two invocations. A third attempt is rejected by the Durable Object before any SQL mutation, so even the intentionally broken lane cannot grow beyond two staging effects.

This separation is the point: Action Check judges the external observation, not the mutation handler's success claim.

## HTTP contract

All four endpoints require `POST`, `Content-Type: application/json`, and an `Origin` that exactly matches `ALLOWED_ORIGINS`.

| Path | Request | Success |
| --- | --- | --- |
| `/v1/reset` | `{ "trialRef": { "trialId", "epoch", "digest" }, "requestId" }` | `RefundTargetReset` with two opaque run capabilities and zero-effect baselines |
| `/v1/invoke` | `{ "run": RefundTargetRun, "input": IssueRefundInput }` | `{ "runId", "requestId", "claim" }`; deliberately no effect evidence |
| `/v1/observe` | `{ "run": RefundTargetRun }` | authoritative `RefundTargetObservation` |
| `/v1/cleanup` | `{ "runs": { "broken": RefundTargetRun, "protected": RefundTargetRun } }` | `204 No Content` |

The wire types are exported from [`src/index.ts`](./src/index.ts). Every body is strict: missing fields, unexpected fields, invalid capability shapes, and changed retry arguments are rejected.

## Capability and storage model

Each reset creates two independent 256-bit random bearer capabilities. The raw capability is returned as `runId`; only its SHA-256 hash is used for Durable Object routing and persisted in SQLite. The default lease is 15 minutes, bounded in code to 1–60 minutes, and an alarm removes expired storage. Treat a `runId` like a temporary credential: do not log, persist, or share it.

The browser origin allowlist reduces accidental cross-site use but is not authentication for non-browser clients. The unguessable, expiring capability authorizes invoke, observe, and cleanup.

`/v1/reset` is guarded before request decoding or Durable Object allocation by the `RESET_RATE_LIMITER` Cloudflare binding. It permits 20 reset requests per 10 seconds for each exact allowlisted app origin. The origin is intentionally a class-of-user key rather than an IP address. Cloudflare rate limiting is per-location and permissive/eventually consistent, so it is an abuse-pressure control rather than an accounting invariant; the two-invocation ceiling remains strongly enforced inside each Durable Object.

## Local verification

```sh
cd workers/refund-staging-target
npm ci
npm run check
npm run dev
```

The local Worker listens at `http://127.0.0.1:8787`. The default allowlist accepts the Vite development origins on port `5173` and preview origins on port `4173`, for both `127.0.0.1` and `localhost`.

`npm run check` verifies generated binding types, TypeScript, eleven Workers-runtime integration tests, the reset allocation guard, the two-invocation ceiling, concurrent retry deduplication, capability expiry, Durable Object SQLite persistence across eviction, and a Wrangler deployment dry run.

## Deployment gate

The checked-in top-level environment is local-only. Deploy only the named `production` environment.

1. Confirm `env.production.vars.ALLOWED_ORIGINS` is the exact HTTPS origin of the deployed Action Check app. Comma-separated exact origins are supported; wildcards and `null` are rejected.
2. Set `env.production.vars.DEPLOYMENT_ID` to a traceable immutable identifier, such as the release tag or commit SHA.
3. Confirm the production rate-limit namespace is distinct from every other binding in the Cloudflare account.
4. Keep `CAPABILITY_TTL_SECONDS` between `60` and `3600`.
5. Run `npm run check` and `npm run deploy:dry-run:production`.
6. Deploy intentionally with `npm run deploy:production`, then configure the browser app to use the resulting HTTPS Worker origin.
7. From the deployed app origin, run reset → two invokes per lane → observe → cleanup and confirm `broken = 2` and `protected = 1`.

No secret is required or stored in this project. If future adapters add provider credentials, add them with `wrangler secret put`; never add them to `vars` or source.

## Platform choices

The implementation follows current Cloudflare guidance: [SQLite-backed Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [RPC methods](https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/), the declarative [`exports` lifecycle configuration](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/), the native [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), and the current [Workers Vitest plugin](https://developers.cloudflare.com/workers/testing/vitest-integration/).
