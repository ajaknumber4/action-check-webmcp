# Verification and fidelity evidence

**Evidence date:** 2026-09-01

**Current product:** Action Check

**Release status:** the external refund staging target and frontend are publicly deployed. The stable URL passed an interactive ChatGPT in-app-browser WebMCP journey, 16/16 deployed desktop/mobile browser journeys, and 1/1 installed-Chrome native WebMCP journey. Release scans and repository publication pass. The public narrated video, participant-specific Devpost fields, and explicit final submit remain open.

## Public release record

| Check | Result |
|---|---|
| Live frontend | `https://action-check-webmcp.vercel.app/` returned HTTP 200 and the exact release artifact |
| Live outcome plane | Cloudflare Worker production environment deployed with one exact frontend origin, a 900-second lease, distinct rate-limit namespace, and immutable `action-check-2026-09-01-r1` identity |
| Interactive judging-client journey | Passed in the ChatGPT desktop in-app browser: all three tools discovered; reset → visible human approval → four invokes → separate proof completed; zero browser warnings/errors |
| Live observed result | Broken: 2 calls / 2 effects / expected failure. Protected: 2 calls / 1 effect / pass. Proof bound deployment, trial digest, request ID, effect IDs, and evidence digests |
| Deployed desktop/mobile suite | Passed 16/16 Playwright journeys against the stable public URL, including Axe, keyboard, touch-target, readability, and horizontal-overflow gates |
| Deployed native WebMCP suite | Passed 1/1 against the stable public URL in Google Chrome 152.0.7977.65 with WebMCP enabled |
| App and Worker regression | Passed 21 app files / 140 tests, 1 Worker file / 11 tests, generated binding check, TypeScript, production and local Wrangler dry-runs, and Vite production build |
| Security and privacy | No Critical/High blocker; both dependency audits reported zero vulnerabilities; exact CSP/security headers are live; non-allowlisted Worker origin returned 403 with no CORS grant |
| Public repository | `https://github.com/ajaknumber4/action-check-webmcp` published from a sanitized release root |
| Final release captures | `action-check-live-discovery.jpg`, `action-check-live-approval.jpg`, and `action-check-live-proof.jpg` captured from the deployed build |

## Previous browser-local baseline

Recorded at `2026-08-31T19:26:31Z` against HEAD `134357de3f98feb19f5b6020d16a52f572b11142` plus 70 modified/untracked working-tree entries. This record predates the external staging target and is retained only as a UI/WebMCP baseline. It is not evidence for the current external path.

| Command/check | Result |
|---|---|
| `npm run ci:check` | Passed: public-boundary scan, TypeScript, 19 test files / 124 tests, and Vite production build |
| `npm run test:e2e` | Passed: 16 Playwright journeys across desktop Chromium and Pixel 7 emulation, including every human-agent handoff, 375×667 first-viewport, 12 px computed label/result floors, label-wrapping, touch-target, embedded Axe, and keyboard gates |
| `npm run test:native-webmcp` | Passed: 1 installed-Chrome journey covering native discovery, every visible actor/action transition, pre-approval rejection, approval, four target calls, and bound proof |
| Deduplication mutation check | Passed sensitivity requirement: disabling protected-ledger reuse caused the ledger and journey tests to fail; restoring it returned 7/7 focused tests to green |
| Registration ownership regression | Passed: same session reuse, conflicting-session rejection, reentrant disposal, throwing subscribers, partial-registration cleanup, and clean replacement |
| Canary concurrency regression | Passed: the eight-test broker suite covers same-ID single-flight, leader disconnect, bounded shared failure, failure eviction, successful retry, and different-ID `429 CANARY_BUSY` |
| Runtime | Node.js 22.20.0; npm 10.9.3; Playwright 1.62.1; Google Chrome 151.0.7922.175 with `WebMCP` enabled |
| Native invocation compatibility | Chrome 151 required its legacy JSON-text `executeTool` input after an object-input capability probe; registered tool schemas and handlers receive validated objects |
| Public-boundary inventory | Historical text scan passed; its binary count is superseded by the current seven-asset inventory below |
| Current-tree secret scan | Gitleaks directory scan passed across the uncommitted worktree |

## Current external-target focused record

These checks cover the external boundary and are supplemented by the public release record above:

| Check | Result |
|---|---|
| Refund target session contract | Passed: 11 focused tests cover expected known-bad failure/protected pass, zero-baseline reset and cleanup, stale approval invalidation, per-attempt effect and ID transitions, dirty-baseline refusal, serialized concurrent calls, invalid/lost-response reconciliation, cancellation before and after commit, and untracked third-invocation rejection |
| Browser HTTP adapter | Passed: 3 focused tests cover fixed request paths and bodies, HTTPS/loopback policy, strict response bounds and schemas, and cancellation forwarding |
| Refund session/WebMCP regression subset | Passed: 3 files / 25 tests against the injected target boundary |
| Refund hero DOM | Passed: 10 focused tests with external-staging copy, recovery guidance, and proof fields |
| Worker runtime and deploy dry-run | Passed: generated bindings, TypeScript, 11 Workers-runtime integration tests, reset allocation guard, exact two-invocation ceiling, and Wrangler dry-run |
| External outcome mutation proof | Passed sensitivity requirement: the protected-outcome guard was temporarily weakened, the false-success observer test failed, the guard was restored, and the focused test returned to green |
| Root TypeScript check | Passed after the external-target integration |
| Consolidated app regression and production build | Passed: 21 files / 140 tests and Vite production build |
| Worker regression | Passed: 1 file / 11 tests, generated binding types, TypeScript, and Wrangler deployment dry-run |
| Desktop/mobile browser regression | Passed: 16/16 Playwright journeys with embedded Axe and keyboard assertions |
| Native installed-Chrome WebMCP regression | Passed: 1/1 native discovery-and-invocation journey |
| Manual local app-to-Worker journey | Passed: reset → approval → four invokes → proof; call outcomes `ACK_LOST`, `ok`, `ACK_LOST`, `ok`; fresh observation showed `2` versus `1`; zero console or page errors |

The Worker uses a separate leased SQLite Durable Object for each lane/run. Its `/v1/invoke` response contains only an action claim; `/v1/observe` returns fresh UUID effect IDs, count, sequence, timestamp, and evidence digest. This is authoritative evidence for Action Check's own synthetic WebMCP fixture, not a payment-provider record or an independently registered tool from another team.

## Current verification target

Release evidence must cover the path a judge will actually use:

1. Native WebMCP exposes exactly Action Check's own `stage_refund_comparison`, `issue_refund`, and `prove_refund_comparison` fixture tools by default.
2. The agent calls `stage_refund_comparison`; reset creates two opaque leased run capabilities and separate observations prove a zero-effect baseline before approval is possible.
3. `issue_refund` is blocked before visible human approval.
4. Approval binds the exact trial, epoch, digest, payment, amount, currency, and request ID.
5. Changed, stale, cancelled, closed, malformed, and over-limit calls fail closed.
6. Each delivery invokes the staging action, then reads the selected run through the separate observation route; the invocation claim cannot supply effect evidence.
7. The first delivery in each lane commits one effect, returns an uncertain acknowledgement, and produces `PROVIDER_ACK_LOST_AFTER_COMMIT` only after the separate observation endpoint finds the commit.
8. The second broken-lane delivery creates a second effect.
9. The second protected-lane delivery reuses the first effect.
10. Proof is withheld until both lanes receive exactly two calls and fresh observations are available.
11. Final proof requires the known-bad lane to fail with `2 calls / 2 effects` and the protected lane to pass with `2 calls / 1 effect`.
12. The receipt binds the trial ID, trial digest, request ID, staging deployment identity, exact observed effect IDs, and both evidence digests.
13. The UI shows native status, the human checkpoint, live lane evidence, and the final result without implying real money movement.
14. One live handoff strip names the next actor and advances through `stage`, `approve`, `deliver`, `retry`, `prove`, and `complete`, including `running`-to-`running` lane updates.
15. The always-visible Agent tools strip shows the exact three names and a truthful registration state; supporting fixtures are explicitly UI-only.
16. The four supporting fixtures still verify booking drift, duplicate refunds, cloud false success, and social-publish false success.
17. Each supporting negative control proves that the relevant test fails when its protection is removed, then recovers through **Run safe version**.
18. Social Neuron remains an optional disabled integration unless exact isolated-staging attestation succeeds.

## Evidence status

| Evidence | Current status |
|---|---|
| External target session contract | Passed focused tests for zero-baseline reset, known-bad failure, protected pass, stale approval, false success, and dirty baseline |
| Browser HTTP adapter | Passed fixed-route, strict-schema, response-bound, HTTPS/loopback, and cancellation tests |
| Synthetic refund staging Worker | Publicly deployed and verified with 11 Workers-runtime integration tests plus local and production Wrangler dry-runs |
| Three-tool WebMCP adapter | Passed focused injected-target coverage, the consolidated 140-test app regression, interactive in-app-browser discovery/invocation, and deployed native Chrome |
| Refund hero DOM behavior | Passed 10 focused states with external-staging guidance, configured-before-reset status, reset-required recovery, and proof binding |
| Full TypeScript, unit, DOM, and production-build regression | Passed: 21 files / 140 tests plus production build |
| Desktop/mobile browser journeys | Passed 16/16 against the stable deployed URL with embedded Axe and keyboard assertions |
| Automated accessibility and keyboard activation | Passed in the 16-journey deployed browser suite |
| Native Chrome WebMCP registration and invocation | Passed 1/1 in Chrome 152.0.7977.65 against the stable deployed URL |
| Interactive agent discovery in the named judging client | Passed in the ChatGPT desktop in-app browser on 2026-09-01; three tools discovered and invoked end to end |
| Manual browser review | Deployed journey passed reset, visible approval, four invokes, and proof with observed `2` versus `1`; zero console/page warnings/errors; three final captures recorded |
| Four supporting synthetic fixtures | Passed in unit/DOM/browser regression, including negative-control recovery paths |
| Social Neuron adapter tests using local fakes | Existing local coverage does not establish a deployed integration |
| Live Social Neuron staging canary | Not run; required endpoints, isolated database, worker wiring, and independent sink are not deployed or configured |
| Public refund staging target | Deployed on public HTTPS with bounded synthetic-only capabilities |
| Production target configuration | Passed: frontend build points to the exact Worker HTTPS origin; Worker allows only the stable frontend origin |
| Public-boundary scan | Passed; final live captures are fictional-data-only and contain no populated EXIF/IPTC/XMP metadata |
| Seven binary-asset metadata review | Passed on 2026-08-31: no populated EXIF, IPTC, or XMP fields were found in the seven current assets |
| Seven binary-asset visual review | No people, customer records, or third-party logos observed; the integrated proof capture is current local QA evidence, while the other six are historical |
| Dependency and licence review | Root and Worker audits passed with 0 vulnerabilities; direct runtime licences are MIT/OFL-1.1 and font texts/notices are present |
| Full-history secret and personal-information scans | Candidate public source passed secret/PII scans; public repository uses a sanitized release root rather than older local metadata |
| Public repository | Published at `https://github.com/ajaknumber4/action-check-webmcp` |
| Public HTTPS deployment | Published and verified at `https://action-check-webmcp.vercel.app/` |
| Public demo video | Missing |
| Devpost status | Not submitted; project remains a draft |

The remaining release evidence is the public narrated YouTube video and the final Devpost submission receipt.

## Required command evidence

Run from the exact release commit and retain the output:

```sh
npm run ci:check
npm run check:staging-target
npm run test:e2e
npm run test:native-webmcp
```

The evidence record must include:

- commit and release tag;
- Node.js, browser, and WebMCP-capable client versions;
- passed, failed, and skipped counts;
- final public-boundary text and binary review counts;
- desktop and mobile viewport results;
- Axe and keyboard-only results;
- agent-discovered tool names and invocation order;
- public repository, deployment, and video URLs.

## Native judge journey

The native-browser test and recorded demo must use this order:

1. Agent discovers the three tools.
2. Agent calls `stage_refund_comparison`; the external target returns matching zero-effect baselines before the page offers approval.
3. Agent attempts `issue_refund` before approval and receives `HUMAN_APPROVAL_REQUIRED`.
4. Human selects **Approve exact staging refund** in the page.
5. Agent calls `issue_refund` twice for `broken` with the approved values.
6. Agent calls `issue_refund` twice for `protected` with the same approved values and request ID.
7. Agent calls `prove_refund_comparison`, which performs fresh observations.
8. UI and tool result both show known-bad `FAIL (expected), 2/2` and protected `PASS, 2/1`, bound to the staging deployment and observed evidence digests.

The browser test must exercise the runtime's native discovery and invocation APIs. Calling stored JavaScript definitions directly is useful adapter coverage, but it is not native WebMCP evidence.

## Required fail-closed checks

- issue before staging;
- reset response with a dirty baseline, mismatched lane/run, invalid attestation, expired lease, or malformed evidence;
- issue after staging but before approval;
- stale trial reference;
- wrong payment, amount, currency, or request ID;
- extra input properties;
- third delivery to either lane;
- proof before four total deliveries;
- cancellation before state mutation;
- success-shaped invocation claim with zero or mismatched observed effects;
- unavailable or stale observation after a target invocation;
- cleanup on trial replacement and session close;
- tool disposal and page teardown;
- forged or incomplete proof inputs;
- optional Social Neuron registration before attestation.

Verifier sensitivity must be demonstrated by mutating or bypassing the real guard and confirming that the relevant test fails, then reverting the mutation before the release regression.

## Supporting-suite evidence

The supporting suite must remain visibly secondary to the refund hero while preserving these checks:

| Fixture | Safe path | Sensitivity path |
|---|---|---|
| Booking changed after approval | Changed quote blocks booking | Removing state binding permits unsafe booking and the test catches it |
| Refund retried twice | Reused request ID creates one effect | Removing deduplication creates two effects and the test catches it |
| Deploy said done, state unchanged | Unhealthy state rejects success | Trusting the response lets false success escape and the test catches it |
| Post said live, stayed draft | Draft state rejects success | Trusting the response lets false success escape and the test catches it |

For false-success cases, the UI must say `Unchanged — false success caught`. A passed verification must not be presented as a completed deployment or published post.

## Historical evidence boundary

The earlier OAuth recovery interface, legacy internal workbench-control tools, and pre-refund Action Check screenshots are historical only. Their local test and native-registration results do not verify the current default three-tool target.

Do not use historical counts, tool names, screenshots, or claims as current submission evidence.

## Fidelity target

The implemented refund hero, not the older concept images, is the release reference.

| Comparison point | Required result |
|---|---|
| Product framing | `Action Check`, `Test what WebMCP actions actually change.`, and `Can one retry accidentally refund twice?` |
| WebMCP visibility | Native status and the exact three-tool surface are always visible in the hero |
| Target truthfulness | Kicker says `WebMCP fixture · external staging`; target remains `Configured`, not ready, until reset proves reachability |
| Agent role | Resets staging, delivers, and proves only through registered tools |
| Human role | Approves the exact current trial only through the page |
| Negative control | Broken lane shows 2 calls and 2 effects |
| Protected target | Protected lane shows 2 calls and 1 effect |
| Evidence integrity | Fresh external staging observations determine proof; invocation claims cannot pass |
| Ownership boundary | `issue_refund` is Action Check's fixture backed by its staging Worker, not another team's independently registered WebMCP tool |
| Disclosure | Staging sandbox, no connected account, no real money |
| Responsive behavior | No horizontal overflow; semantic order preserved |
| Supporting breadth | Four cases remain available below the hero |

## Current binary artifacts

| Asset | Status |
|---|---|
| `docs/design/action-assurance-lab-concept.png` | Historical generated concept; not final evidence |
| `docs/design/workbench-awaiting-approval-concept.png` | Historical generated OAuth concept; exclude from final submission |
| `docs/design/workbench-receipt-ready-concept.png` | Historical generated OAuth concept; exclude from final submission |
| `docs/screenshots/action-assurance-duplicate-proof.jpg` | Historical pre-hero local capture; replace before submission |
| `docs/screenshots/action-assurance-false-success-mobile.jpg` | Historical pre-hero local capture; replace before submission |
| `docs/screenshots/workbench-receipt-ready.png` | Historical OAuth capture containing JPEG data; exclude from final submission |
| `docs/screenshots/external-staging-refund-proof.png` | Current local integrated proof capture; valid QA evidence, but recapture from the deployed release before submission |
| `docs/screenshots/action-check-live-discovery.jpg` | Final deployed 16:9 discovery and three-tool surface |
| `docs/screenshots/action-check-live-approval.jpg` | Final deployed human-approval checkpoint |
| `docs/screenshots/action-check-live-proof.jpg` | Final deployed 2-versus-1 external proof |

Final screenshots and video must be captured from the exact submitted build, contain fictional values only, show truthful native status, and pass a frame-by-frame public-boundary review.
