# Scope

## Product outcome

Demonstrate how a consequential WebMCP action can be checked against observed effect state, rather than accepting the action response as proof.

Action Check's primary demonstration is a broken-versus-protected synthetic refund retry against a separately served staging target. The three WebMCP tools, including `issue_refund`, are Action Check-owned fixtures rather than registrations discovered from another team's site. An agent must use those tools, the reset trial must be approved through the visible page control, and proof must come from a fresh read of the target's effect state rather than its invocation claim. Four supporting UI-run fixtures show the same verification pattern across travel, payments, cloud deployment, and publishing.

## Primary user

A web product engineer, integration engineer, or developer-support engineer designing consequential browser-agent actions and needing a concrete way to test stale authorization, duplicate effects, and false-success responses.

## MVP

- One resettable, no-login browser experience
- One primary WebMCP-native refund comparison:
  - a fixed synthetic payment, amount, currency, and request ID;
  - visible human approval bound to those exact values;
  - a broken lane where two deliveries create two effects;
  - a protected lane where the same two deliveries create one effect;
  - one leased, per-trial external staging run for each lane, backed by SQLite Durable Object state;
  - an invocation path that returns only an action claim and a separate observation path that returns effect evidence;
  - a reset gate that requires zero effects in both lanes before approval;
  - a proof receipt bound to the trial digest, request ID, exact observed effect IDs, evidence digests, and staging deployment identity;
  - mandatory cleanup when a trial is replaced or its browser session closes
- Exactly three default WebMCP tools:
  - `stage_refund_comparison`
  - `issue_refund`
  - `prove_refund_comparison`
- No page button that stages, delivers, or proves the primary comparison; those steps require WebMCP
- One human page control that approves the exact staged synthetic trial
- Strict input schemas, bounded outputs, cancellation forwarding, lifecycle cleanup, same-session registration reuse, and conflicting-session rejection
- A strict browser HTTP adapter with fixed `reset`, `invoke`, `observe`, and `cleanup` routes; HTTPS is required outside loopback
- One separately deployable synthetic refund staging Worker with expiring opaque run capabilities, exact-origin CORS, per-lane SQLite Durable Objects, and a known-bad control
- An exact two-invocation ceiling enforced inside each Durable Object, independent of the serialized browser-session guard
- A reset allocation guard using Cloudflare's native rate-limit binding; it is abuse pressure, not an authorization or globally exact accounting boundary
- Four deterministic supporting UI-run fixtures:
  - a booking quote that changes after approval;
  - a refund retried after its first acknowledgement is lost;
  - a deployment that claims success while remaining unhealthy;
  - a post that claims success while remaining draft
- Supporting-fixture sensitivity checks that deliberately remove the protection before running the safe version
- One optional `run_social_neuron_canary` registration, present only after exact staging readiness attestation
- A blocked-by-default Social Neuron HTTP adapter and same-origin broker for two fixed staging trials
- Unit, contract, DOM, browser, accessibility, native-registration, redaction, concurrency, and scenario-semantic evidence
- Actual judging-client discovery and invocation as a release gate

## Safety constraints

- Static fictional business data and staging-only synthetic effects
- No customer, employee, provider-account, or other personal information
- No browser, fixture, report, or public schema field capable of holding raw credentials, cookies, tokens, authorization artifacts, or secret material
- No payment-provider request, production mutation, customer content, customer account, analytics, or telemetry
- Agent tools cannot approve, reject, edit, reset, select a scenario, or download a result
- `issue_refund` fails closed unless its exact payment, amount, currency, and request ID match the current human-approved trial
- A changed, replaced, or closed trial invalidates approval and rejects late work; an already-aborted invocation is rejected before mutation
- Each comparison lane accepts at most two deliveries
- The target invocation response cannot create proof; `issue_refund` and `prove_refund_comparison` must use the separate observation route
- A trial cannot become approvable unless reset returns matching run capabilities, staging attestation, and a zero-effect baseline for both lanes
- Run capabilities are opaque, short-lived, omitted from judge-facing outputs, and cleaned up when a trial is replaced or closed
- The production frontend must receive the exact HTTPS target origin through `VITE_REFUND_STAGING_TARGET_URL`; the Worker must allow only the exact frontend origin
- Each live run ID is a short-lived bearer capability: only its hash is persisted, and the raw value must not enter judge-facing output, logs, or committed evidence
- Invoke transport ambiguity must be reconciled against the exact observed sequence; a mismatched or unavailable observation locks the lane until reset
- The optional canary credential remains server-only; the browser cannot choose an origin, environment, account, content, provider, or trial
- The canary must attest an isolated database, canary sink, absence of live credentials and egress, exact deployment identity, and production-lifecycle worker mode before mutation
- Staging runs use durable request idempotency, leased fixtures, independent outcome reads, mandatory cleanup, and broker-level single-flight protection
- Same-origin, active top-level document only
- No declarative, iframe, cross-origin, or proposed interaction APIs in the critical path
- A passed synthetic check must never be presented as proof of a real payment, booking, deployment, or publication

## Non-goals

- Real refunds, OAuth, production publishing, or live-provider actions
- A universal exactly-once guarantee or distributed transaction protocol
- Production monitoring, tracing, incident ingestion, or customer-data analysis
- A generic policy engine, WebMCP inspector, post-condition language, or complete security framework
- Production repair or customer-selected private-system actions
- User accounts, multi-tenancy, teams, billing, or administration
- A customer-facing product backend, customer database, remote MCP server, browser extension, or in-app language model
- More than the three default refund-comparison tools plus the single attested canary tool
- Presenting the four supporting fixtures as additional registered WebMCP targets
- Claiming that the current fixture automatically tests another site's independently registered WebMCP tool
- Decorative complex animation or an internal chat interface

## Success gate

### Primary WebMCP demonstration

From a clean reset in the exact judging browser:

1. The agent discovers the three default tools.
2. `stage_refund_comparison` resets two leased external staging runs and proves that both start with zero effects.
3. `issue_refund` is rejected before the person approves the displayed trial.
4. The person approves the exact payment, amount, currency, and request ID in the page.
5. The agent calls `issue_refund` twice for each lane with that same request ID; each call invokes the target and then observes the lane separately.
6. `prove_refund_comparison` performs fresh observations, requires the known-bad lane to expose two effects and the protected lane to expose one, and displays broken `2 calls / 2 effects` versus protected `2 calls / 1 effect`.
7. The receipt binds the trial digest, request ID, staging deployment identity, every observed effect ID, and both evidence digests.
8. Replacing the trial or closing the browser session requests cleanup of both leased staging runs; the lease remains the final expiry backstop.

The page must not offer a UI-only substitute for staging, delivery, or proof.

### Supporting suite

The four UI-run cases must remain usable without WebMCP and reach these truthful conclusions:

- **Booking changed:** the changed quote prevents booking creation.
- **Refund retried:** two calls produce exactly one refund.
- **Deploy said done:** unhealthy authoritative state rejects the success claim.
- **Post said live:** draft authoritative state rejects the success claim.

### Optional staging canary

When—and only when—the Social Neuron staging go-live gate is satisfied, the false-success trial must be rejected, the truthful control accepted with exactly one canary-sink delivery, both fixtures cleaned up, and no provider request made.

Every visible and returned value must be truthful, non-sensitive, bounded, and explicit about whether evidence is synthetic. The external refund staging target and frontend are publicly deployed, and the exact HTTPS pair passed an end-to-end ChatGPT in-app-browser journey plus deployed Chrome/browser suites. The optional canary may create only leased effects in the isolated database and canary sink described by its [go-live contract](./docs/integrations/SOCIAL_NEURON_STAGING_CANARY.md).
