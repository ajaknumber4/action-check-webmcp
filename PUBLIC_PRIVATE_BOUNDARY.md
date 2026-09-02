# Public/private boundary

This repository is an independent hackathon implementation. It contains no External Target private source, history, credentials, incident records, customer data, production traces, or production infrastructure. The optional External Target integration targets a new, narrow staging-canary contract; no private implementation code or live evidence is copied into this repository.

## What may be public

- Browser application source and styling
- The three Action Check-owned top-level WebMCP fixture registrations: `stage_refund_comparison`, `issue_refund`, and `prove_refund_comparison`
- The synthetic refund staging Worker, its fixed HTTP contract, Durable Object schema, exact-origin CORS, reset rate-limit binding, and local deployment configuration
- One conditional `run_external_target_canary` registration after exact staging attestation
- The fixed synthetic refund trial and its broken and protected provider lanes
- Leased per-run SQLite Durable Object records containing fictional effects with random UUID effect IDs and bounded SHA-256 evidence digests
- Four supporting static fixtures for booking drift, duplicate refunds, cloud false success, and social-publish false success
- Generic state-machine, verification-rule, negative-control, and receipt logic
- The generic server-only staging protocol, same-origin broker, strict schemas, and non-sensitive fixed canary aliases
- Exact-reference approval and stale-reference invalidation logic
- Redaction and bounded-output assertions
- Tests, evaluations, documentation, and deployment configuration
- Original or properly licensed assets

## What must never enter the repository

- Source, history, packages, prompts, tickets, or documentation from any private project
- Real provider configuration, payment state, retry infrastructure, publication logic, or private External Target source
- Real agent traces, support cases, incident evidence, analytics, or telemetry
- Credentials, private keys, cookies, session identifiers, authorization artifacts, tokens, or raw secret material
- Customer, employee, entrant-personal, or other personal information
- Production payment, account, document, post, deployment, state-digest, effect-key, or postcondition identifiers
- Code that connects to, changes, or simulates privileged access to a production system
- Hard-coded or captured private staging URLs, credentials, run identities, attestation digests, sink receipts, or raw live evidence
- Live refund `runId` values: they are short-lived opaque bearer capabilities even though the effects they protect are fictional

## Main demo boundary

The registered refund target is Action Check's own closed WebMCP fixture. It is backed by a separately served HTTP outcome plane; it is not another team's independently registered WebMCP tool:

- payment `pay-204`, amount `4200`, currency `USD`, and request `refund-request-204` are fixed fictional values;
- `stage_refund_comparison` requests two leased staging runs, requires matching zero-effect baselines, and invalidates any older approval;
- only the visible first-party control can approve the exact current trial;
- `issue_refund` rejects missing approval, stale approval, changed values, extra calls, cancellation, and closed sessions;
- the browser session serializes all stateful calls so concurrent same-session requests cannot race its attempt count;
- each opaque 256-bit run capability is bound to the exact lane, request, trial digest, attestation, and short lease; only its SHA-256 hash is stored and used for Durable Object routing;
- the first call to each lane commits one Durable Object effect with a random UUID, returns an uncertain acknowledgement, and is reconciled through the separate observation route;
- the second broken-lane call creates another durable UUID effect;
- the second protected-lane call reuses the first effect;
- every run Durable Object rejects a third invocation before SQL mutation and constrains its stored sequence to `0..2`, independently of the browser check;
- `/v1/invoke` returns no effect IDs or counts; `/v1/observe` supplies the exact durable sequence, UUID effect IDs, timestamp, and evidence digest;
- if an invoke response is lost, Action Check observes the same run: an exact increment is reconciled, no increment can be retried, and any other result locks the lane until reset;
- `prove_refund_comparison` performs fresh observations and returns proof only for known-bad `2/2` and protected `2/1`, then binds the visible receipt to the exact trial, digest, request ID, deployment identity, UUID effect IDs, and evidence digests.

The synthetic staging ledger persists outside the page session in leased SQLite Durable Objects and is read separately from the invoke response, but it is still implemented and operated as part of Action Check. It is not independent third-party attestation, a payment-provider record, or a reusable test of another team's WebMCP registration. No payment account, provider API, customer database, analytics service, or money movement is involved. The Worker is publicly deployed for judging with 15-minute capabilities, an exact frontend-origin allowlist, and a two-invocation ceiling per run.

`/v1/reset` is checked before body decoding and Durable Object allocation by Cloudflare's `RESET_RATE_LIMITER`, nominally 20 requests per 10 seconds for each exact allowlisted app origin. This is an abuse-pressure guard, not an authorization or accounting boundary: the key is shared by an origin, and Cloudflare documents the limiter as per-location and permissive/eventually consistent, so distributed requests may exceed the nominal rate. Exact two-invocation enforcement remains inside each Durable Object.

## Supporting-fixture boundary

All four lower-suite cases are authored synthetic examples:

- **Booking changed after approval** uses a fictional trip, quote, and booking effect.
- **Refund retried twice** uses a fictional payment and simulated attempt/refund counts.
- **Deploy said done, state unchanged** uses a fictional service and simulated health state.
- **Post said live, stayed draft** uses a fictional social post, success-shaped result, and simulated authoritative draft state.

The UI runs these fixtures through a browser-local application session. They are not additional default WebMCP targets. They are evidence-informed hypotheses, not customer incidents, measured demand, or production failure statistics.

## External Target staging boundary

The optional server broker may call only a configured External Target staging-canary origin. The browser supplies one request ID and cannot supply a URL, environment, account, provider, content, or credential. A run is permitted only after the service attests an isolated database, canary sink, exact deployment identity, production-lifecycle worker, absent live-provider credentials, and disabled provider egress.

The required upstream service is not deployed or configured in this repository. `run_external_target_canary` is therefore absent by default, the UI shows **Optional external-target staging · disabled**, and no live staging result is claimed.

## Human and agent authority

The registered WebMCP surface lets an agent reset the fixed Action Check fixture, deliver the exact approved synthetic calls, and request the final proof. `issue_refund` is registered by Action Check and invokes Action Check's configured staging Worker; it is not discovered from or registered by an external team's site. The surface exposes no approval tool and cannot alter the fixed payment, select another target, exceed two calls per lane, or turn an invocation claim into proof. A separate browser-automation agent could still operate ordinary page controls; Action Check does not claim otherwise.

The human may approve only the exact current trial shown in the first-party page. Approval binds the trial ID, epoch, digest, payment, amount, currency, and request ID. A changed or superseded reference requires a new review.

The supporting suite's one-click controls run closed deterministic fixtures and do not grant external authority.

## Publication gate

Before any public remote, deployment, video, or submission update:

1. Run `node scripts/check-public-boundary.mjs`.
2. Run full-history secret and independent personal-information scans.
3. Review every tracked path, dependency, licence, generated artifact, fixture value, screenshot, and video frame.
4. Manually review all seven current binary assets listed in `HACKATHON_PROVENANCE.md`; use fresh screenshots from the exact release build for submission.
5. Confirm that all payments, cases, identities, effects, outcomes, and timestamps remain fictional and redacted.
6. Verify the three-tool native refund path, exact human approval, broken `2/2`, protected `2/1`, and proof withholding on every fail-closed branch.
7. Verify the Worker zero-baseline contract, opaque lease binding, exact two-invocation ceiling, UUID evidence, cleanup, exact-origin CORS, and pre-allocation reset guard.
8. Verify the four supporting fixtures, bug-sensitivity checks, false-success wording, responsive behavior, accessibility, cancellation, and invoke-loss reconciliation.
9. Test agent discovery and invocation in the exact judging client against the exact deployed Worker; do not infer this from registration or local fakes alone.
10. Confirm `VITE_REFUND_STAGING_TARGET_URL`, Worker allowlisted origins, deployment identity, rate-limit namespace, and release headers match the submitted deployment.
11. If the External Target canary is enabled, complete its documented go-live gate and retain only redacted, non-sensitive deployment and result evidence.
12. Record the exact public repository, frontend and Worker deployment identifiers, video URL, release tag, and final test results.
13. Obtain explicit release approval.

The local boundary check is a fast denylist guard. It does not replace full-history scanning, dependency review, asset inspection, video-frame review, or manual release approval.
