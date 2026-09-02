# Final current-worktree adversarial review

Date: 2026-08-31

Fixed point: HEAD `134357de3f98feb19f5b6020d16a52f572b11142` plus the uncommitted Action Check worktree. This is a pre-release review, not a review of a frozen public commit.

## Decision

The local implementation is ready to freeze for release. The WebMCP hero now requires three registered tools, keeps approval outside that tool surface, exercises a real registered synthetic target, and proves `2 calls / 2 effects` versus `2 calls / 1 effect` from an append-only effect ledger rather than the target response.

It is not submission-ready until the title, public repository, HTTPS deployment, interactive judging-agent evidence, final screenshots, video, participant fields, and explicit Devpost submission are complete.

## Standards axis

| Finding | Resolution |
|---|---|
| Concurrent same-ID staging requests could both begin after readiness attestation | Fixed with a post-attestation cache recheck and one active shared promise |
| A disconnected leader could abort the run shared by a same-ID follower | Fixed: a started run completes and cleans up independently of any one HTTP waiter |
| Cached and concurrent waiters could receive unbounded failures | Fixed: every waiter receives a bounded response; transient failures are evicted for retry |
| Different request IDs could contend ambiguously | Fixed: the non-owner receives `429 CANARY_BUSY` while one run is active |
| Duplicate refund-tool registration lacked registrar ownership | Fixed: same session reuse; conflicting active session rejection; replacement after disposal/failure |
| Reentrant disposal during the final registration notification could revive a zombie `ready` state | Fixed with an abort check after every notification; tools remain disposed and `ready` rejects |
| A throwing initial subscriber could escape and leak registration state | Fixed by isolating the initial callback like every later notification |
| Partial registration cleanup had no mutation-sensitive regression | Added failure-on-tool-two coverage, zero-tool cleanup, and clean replacement |
| Registration ownership is module-instance-local under development HMR | Accepted P2 development limitation; full reload is documented, production lifecycle is unaffected |

Independent cross-checks found no remaining P0/P1 standards issue after these fixes.

## Specification and truthfulness axis

| Finding | Resolution |
|---|---|
| Release docs still described the historical six-tool workbench | Reconciled to exactly three default refund-comparison tools plus one conditional canary |
| The hero implied WebMCP was ready even when unavailable or failed | Copy and prompt are conditional on native registration state |
| The “exact prompt” omitted required inputs and expected retry handling | Prompt now includes both lanes, every bound field, the expected lost-ack error, identical retry, and final proof call |
| Supporting UI implied its four fixtures were registered native targets | Technical details now label them `UI-only synthetic fixture` |
| Approval binding details were claimed but not visible | Trial ID and business fields are visible; epoch and digest are available before approval in a collapsed disclosure |
| External tool-driven state changes were silent to assistive technology and could lose focus | Added polite live announcements and focus transfer to the approval/proof regions |
| Documentation overstated multiple or independently operated ledgers | Corrected everywhere to one browser-local append-only synthetic ledger with separate lane records, maintained separately from the response |
| Documentation overstated cancellation and agent-proof approval | Clarified that an already-aborted invocation is rejected before mutation and that only the registered WebMCP surface lacks approval; ordinary DOM automation remains possible |
| Submission copy implied an authenticated browser despite a no-login MVP | Removed the authentication claim |

The historical pre-hero audits remain in the repository with prominent superseded-snapshot banners.

## Verification

| Gate | Result |
|---|---|
| Full local gate | 19 files / 122 tests, TypeScript, 115-file public-boundary scan, and production build passed |
| Browser journeys | 14/14 passed across desktop Chromium and Pixel 7 emulation, including a 375×667 first-viewport gate, Axe, and keyboard coverage |
| Native WebMCP | 1/1 installed-Chrome journey passed: discovery, pre-approval rejection, visible approval, four target deliveries, and bound proof |
| Mutation sensitivity | Disabling protected request reuse made the relevant tests fail; restoration returned them to green |
| Registration lifecycle | 8/8 focused registration tests passed |
| Staging broker | 8/8 focused broker tests passed, including concurrency, disconnect, failure, eviction, and retry |
| Dependency audit | `npm audit --omit=dev` reported 0 vulnerabilities after the final UI reconciliation |
| Secret scans | Gitleaks found no leak across the current worktree or the existing four commits; rerun after the release commit |

## Open release blockers

1. Participant confirms the final title; `Action Check` remains the working title.
2. Freeze and review a public commit; rerun every gate and scan against that exact commit.
3. Complete the required independent maker-checker review before merge/release; no external code or plan was sent to Fable/Anthropic without approval.
4. Create and verify a public repository and public HTTPS deployment.
5. Run the complete flow through an actual interactive judging agent on the deployed URL; the native browser automation is strong evidence but not a substitute.
6. Capture final desktop, mobile, and discovery screenshots from the submitted build.
7. Record and publish the under-three-minute YouTube demo.
8. Fill participant-specific Devpost fields and perform the explicit final submission.

The External Target canary is not a blocker for the synthetic hero. It must remain visibly disconnected and excluded from claims unless its separate go-live gate is completed.
