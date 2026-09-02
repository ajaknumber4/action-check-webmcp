# Security model

## Scope and assumptions

Action Check registers its own three-tool WebMCP refund fixture and backs that fixture with a separately served synthetic staging Worker. The Worker is an external outcome plane for the demo, not another team's independently registered WebMCP tool and not a payment provider. It stores leased fictional effects in SQLite Durable Objects and is publicly deployed with an exact frontend-origin allowlist, 15-minute capabilities, reset rate limiting, and a two-invocation ceiling per run. Four lower-page effect tests remain browser-local fictional fixtures. An optional, blocked-by-default server broker can expose one fixed External Target staging canary only after exact readiness attestation; its required service is not deployed or configured here.

The security objectives are to keep approval human-controlled, bind every mutating call to the current approved trial and leased run, prevent an invocation claim from proving its own effect, keep synthetic evidence durable and bounded, prevent unbounded staging allocation and invocation, keep temporary capabilities out of judge-facing output, and distinguish a passed fixture check from a real business outcome.

The design does not claim that WebMCP itself eliminates prompt injection, provides distributed exactly-once execution, verifies arbitrary postconditions, or prevents a general browser agent from operating ordinary page controls.

## Trust boundaries

| Boundary | Implemented control |
|---|---|
| WebMCP caller → Action Check refund adapter | Exactly three Action Check-owned fixture tools; strict schemas and runtime validation; current-state reads; bounded results; cancellation forwarding |
| Refund adapter → comparison session | Agent can reset staging, deliver, and prove, but has no approval capability; all stateful operations are serialized through one session queue |
| First-party page → comparison session | The visible human control submits the exact current `RefundTrialRef`; stale references fail closed |
| Browser adapter → staging Worker | One configured origin and four fixed routes; HTTPS outside loopback; credentials omitted; redirects rejected; strict bounded requests and responses |
| App origin → reset allocation | Exact-origin CORS plus a native `RESET_RATE_LIMITER` check before request decoding or Durable Object allocation; nominal limit 20 resets per 10 seconds per allowed app origin |
| Approved trial → target action | Payment, amount, currency, request ID, trial digest, lane, lease, and attestation must match; the browser session and Durable Object each enforce at most two deliveries per lane |
| Opaque run capability → Durable Object | A random 256-bit bearer capability selects one run; only its SHA-256 hash is persisted and used for routing; the default lease is 15 minutes and cleanup remains available after expiry |
| Target action → effect evidence | `/v1/invoke` returns a claim without effect counts or IDs; `/v1/observe` reads durable SQLite state and returns UUID effect IDs, exact sequence, timestamp, and evidence digest |
| Evidence → receipt | Proof performs fresh observations, requires known-bad `2 calls / 2 effects` and protected `2 calls / 1 effect`, and binds the receipt to trial digest, request ID, deployment, UUID effect IDs, and evidence digests |
| Registrar → page lifecycle | Same session and registrar reuse one registration; a conflicting active session is rejected; failure or disposal releases ownership |
| Supporting fixture → result | Closed fictional scenarios, deterministic rules, and final-state checks; a success-shaped response is insufficient |
| Top-level page → browser client | Direct imperative registration only; no iframe, declarative, cross-origin, or proposed interaction API dependency |
| Browser → canary broker | Fixed same-origin path and strict `{ requestId }` body; no caller-supplied URL, environment, account, content, provider, or trial |
| Canary broker → External Target staging | Server-only credential; HTTPS; rejected redirects; bounded strict responses; exact deployment and safety attestation before mutation; same-request concurrency is single-flighted |
| External Target worker → canary proof | Actual production-lifecycle worker path plus an independent canary-sink read; the handler claim is never sufficient |

## Protected assets

- Integrity of the current human approval and its trial identity
- Integrity of durable synthetic effect evidence and the resulting receipt
- Accuracy of call counts, effect counts, registration state, and proof status
- The distinction between a passed synthetic test and a successful real business action
- The guarantee that the external path changes only the leased synthetic staging fixture, never a payment provider or production system
- Integrity of the four supporting fixtures and their sensitivity checks
- Isolation of the optional canary from production and public providers
- Confidentiality of the server-only staging credential
- Idempotency, evidence, leases, and cleanup for optional staging runs
- Confidentiality of short-lived refund run capabilities while the browser session is active
- Availability of cancellation, reconciliation, teardown, and repeatable reruns

There are no customer records, production configurations, provider sessions, or live-provider credentials in scope. The refund staging Worker needs no secret, but each live `runId` is a temporary bearer capability and must not be logged, committed, persisted by the frontend, or returned in judge-facing WebMCP output. A deployed External Target canary requires one server-only staging credential and an isolated effect ledger; neither may enter the repository or browser output. Only bounded, non-sensitive proof fields may cross either public result boundary.

## Approval identity

The primary trial reference contains a generated trial ID, epoch, and deterministic digest. The digest covers the exact fixed payment, amount, currency, and request ID displayed beside the human approval control. Reset also binds separate broken/protected run capabilities to that digest, request ID, lane, attestation, and lease. Staging a replacement trial changes the epoch and reference, requests cleanup of the prior runs, and invalidates approval; closing the session rejects later work and requests cleanup. `issue_refund` compares every supplied field with the approved trial before invoking a run.

The four supporting fixtures separately use versioned patch references bound to case ID, session epoch, patch values, and digest. Editing, reset, or scenario selection invalidates their confirmation.

The trial digest is a deterministic identity check, not a signature or authorization token. The opaque run capability authorizes only its short-lived synthetic Durable Object. Neither mechanism is a production payment authorization or a general concurrency protocol.

## Proof semantics

The refund proof is available only after the broken and protected lanes each receive exactly two approved deliveries and fresh external observations contain the expected records. External effect IDs are random UUIDs; proof binds the exact observed IDs and evidence digests rather than expecting deterministic IDs. It demonstrates that Action Check's own fixture distinguished duplicate creation from request-bound reuse. It does not test another team's registered WebMCP tool, prove that a payment provider is safe, or show that money moved.

Supporting-fixture results use these distinct outcomes:

- `intended_outcome_verified`: the declared synthetic intended state was observed.
- `unsafe_outcome_prevented`: a prohibited synthetic effect was blocked.
- `false_success_detected`: the tool completed, but the authoritative synthetic postcondition failed.

For `false_success_detected`, the business outcome remains not achieved. The UI and evidence must not imply that the deployment or publication succeeded.

## Abuse cases and controls

| Abuse case | Existing mitigation | Residual risk |
|---|---|---|
| Agent attempts to approve its own refund | No WebMCP approval tool exists; `issue_refund` requires state produced by the visible human control | A general browser agent may still click ordinary DOM controls; judging must keep the checkpoint visibly human-reviewed |
| Agent changes a field after approval | The target accepts only values matching the exact approved trial and run binding; a new staged trial changes the reference and capabilities | This synthetic binding is not a payment authorization protocol |
| Agent retries with a different request ID | Exact-field comparison rejects the call | Real integrations must bind authorization to their own authoritative state |
| More than two deliveries are attempted | The serialized browser session rejects a third call and the Durable Object independently rejects sequence `>= 2` before SQL mutation; SQLite constrains the stored sequence to `0..2` | This strongly bounds one valid run capability; it is not general rate limiting for other applications |
| Two browser calls race in the same session | Every stateful operation is serialized through one promise queue; the per-run Durable Object also serializes mutation | A compromised or separate client can bypass the browser queue, so the Durable Object ceiling remains the authoritative bound |
| Concurrent or duplicate registration creates ambiguous tools | Registrar ownership reuses the same active session and rejects a conflicting session; partial failure aborts and releases ownership | Ownership is module-instance-local, so hot-replacing the registration module during development requires a full page reload; production lifecycle still requires exact-client testing |
| The target claims success without the intended effect | The invocation result contains no effect evidence; `issue_refund` observes after each attempt and `prove_refund_comparison` performs fresh external observations | Action Check owns both the WebMCP fixture and staging Worker; this is architectural separation, not independent third-party attestation |
| An invoke response is lost after commit | The serialized session immediately observes the same run: an exact sequence increment is reconciled as acknowledgement loss, no increment is safe to retry, and any other sequence locks the lane until reset | Observation can also be unavailable; fail-closed locking preserves safety but sacrifices availability |
| The proof fabricates or drops effect identity | Proof requires exact sequence/count invariants and binds every observed UUID effect ID and evidence digest to the approved trial and deployment | Compromise of both frontend and Worker code could replace action and evidence semantics |
| Cancellation or page teardown races with work | Preflight cancellation rejects before mutation; uncertain transport is reconciled by observation; closing rejects future work and requests cleanup | Cancellation cannot undo an already committed synthetic Durable Object effect; lease expiry is the cleanup backstop |
| Anonymous callers allocate excessive staging runs | Reset is checked by Cloudflare's native rate-limit binding before decoding or Durable Object allocation; exact-origin CORS reduces accidental browser use | The limiter is keyed by shared app origin, is per-location and permissive/eventually consistent, and is not authentication or a global accounting invariant; distributed callers may exceed the nominal rate |
| A run capability is stolen | 256-bit randomness, short lease, exact run metadata binding, hashed routing/storage, no judge-facing exposure, and cleanup limit its value | It is still a bearer capability until expiry; browser compromise or network logging could expose it |
| A supporting fixture trusts a success-shaped response | Each rule evaluates declared authoritative synthetic state before passing | Real applications must define and protect their own state source |
| A staging-labelled service points at production or a live provider | Exact identity, aliases, isolation, canary-sink mode, credential absence, egress denial, and production-lifecycle worker mode are attested before mutation | Attestation fields also need infrastructure enforcement and independent deployment review |
| Browser redirects the canary to another target | Browser can reach only the same-origin broker and send one request ID; target configuration is server-side | An origin compromise remains able to replace application and broker code |
| Concurrent staging retries duplicate effects | Broker installs one promise per request ID before starting mutation, reuses it, and lets the shared run finish cleanup if an HTTP waiter disconnects; External Target must enforce durable idempotency | Broker cache is bounded and process-local, so upstream idempotency remains mandatory |
| External Target cleanup hides an unsafe canary result | Canary cleanup failure prevents a pass; fixtures are leased; returned evidence must be append-only | Operators must independently verify retention and abandoned-run cleanup; refund-run cleanup instead relies on explicit requests plus lease expiry |
| Malformed or excessive input reaches a tool | Strict schemas reject missing, unknown, wrong-type, and out-of-range values; runtime validation remains mandatory | Browser implementations can differ in pre-validation behavior |
| Secret-like material reaches output | Public types contain no raw secret fields; output checks and budgets fail closed; public-boundary and history scans are release gates | Pattern checks are defense in depth, not a substitute for source review |
| UI presents test success as business success | Proof status and observed business outcome are separate; synthetic disclosures are visible; DOM and visual checks cover false-success copy | Copy regressions remain possible without release review |
| Presentation subscriber throws | Listener errors are isolated after immutable state commits | Rendering failure can reduce usability without corrupting canonical state |

## Release requirements

Before publishing or deploying:

1. Run unit, DOM, browser, accessibility, public-boundary, dependency, and production-build checks.
2. Run full-history secret and independent personal-information scans.
3. Inspect every public asset, fixture value, generated artifact, dependency licence, and deploy include/exclude rule.
4. Test all three default registrations and annotations, same-session reuse, conflicting-session rejection, cancellation, stale approval, input mismatch, call limits, effect counts, proof, and receipt binding.
5. Run the Worker tests for zero baselines, exact two-invocation ceiling, UUID evidence, protected concurrency, eviction persistence, capability expiry, cleanup, exact-origin CORS, strict JSON, and reset allocation limiting.
6. Mutation-test the observer invariant, confirm the false-success test fails under the weakened guard, restore it, and rerun the focused regression.
7. Test all four supporting conclusions and confirm their deliberate negative controls fail.
8. Verify that false-success completion never appears as a successful business outcome.
9. Exercise discovery and invocation in the exact agent and WebMCP-capable browser named in the submission, with the frontend configured to the deployed Worker.
10. Review exact-origin CORS, HTTPS, rate-limit namespace, deployment identity, leases, observability, and deploy include/exclude rules. Treat the reset limiter as abuse pressure only.
11. If the External Target canary is configured, satisfy every item in its [go-live gate](./docs/integrations/EXTERNAL_TARGET_STAGING_CANARY.md), including a genuinely concurrent broker retry test, a real two-trial run, and independent no-provider-effect review.
12. Obtain explicit release approval before creating a public repository, deployment, video, or Devpost submission.

Security reports must use synthetic reproduction data and contain no credentials or personal information.
