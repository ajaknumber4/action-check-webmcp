# Action Check design specification

Action Check is a browser test lab for WebMCP actions that can create consequential effects. The interface must explain one concrete failure in seconds, show where WebMCP is used, keep approval visibly human, and distinguish a tool response from outcome evidence.

## Product promise

The first viewport must answer four questions:

- **What is this?** A test lab for actions exposed to browser agents.
- **What problem does it catch?** A retry can repeat an effect even when both calls look valid.
- **Where is WebMCP?** The agent must call Action Check's registered fixture tools; the page reports their native registration state.
- **What proves the result?** A fresh read from a separately served synthetic staging ledger, not the target invocation's claim.

The default demo uses an external staging sandbox, but every effect remains fictional. It must never imply a payment account, External Target staging service, payment processor, or production system is connected. The staging target is implemented and locally verified but is not publicly deployed.

The `issue_refund` tool is registered by Action Check and backed by Action Check's Worker. Copy must not imply that the page discovered or tested another team's independently registered WebMCP tool.

## Page hierarchy

Use this order on desktop and mobile:

1. Product header: `Action Check` / `WebMCP effect tests`
2. Plain introduction: `Test what WebMCP actions actually change.`
3. Refund-comparison hero
4. Four-case supporting test suite
5. Selected case's verification rule and injected fault
6. Result, event trace, and collapsed technical details

The refund hero is the submission demonstration. The lower suite proves breadth and must not compete with the hero for the first explanation.

## Refund-comparison hero

### Required framing

- Kicker: `WebMCP fixture · external staging` when the native tools are ready, with truthful alternate registration states. Before staging, target status is `Configured`, not ready. Reachability is established only when `stage_refund_comparison` completes a valid reset; registration or configuration alone must not imply that the target is reachable.
- Heading: `Can one retry accidentally refund twice?`
- Support: explain the lost response, unsafe-versus-protected retry, WebMCP invocation, and final refund count in plain language. Keep ledger terminology out of the first explanation.
- Disclosure: `Staging sandbox only. No payment account is connected and no real money moves.`
- Native status: always show `Native WebMCP` with truthful ready, loading, failed, or unavailable text. It must wrap rather than truncate; unavailable state points judges to Chrome 149+ with the WebMCP flag or ChatGPT's browser.
- Agent-tool strip: always show `stage_refund_comparison`, `issue_refund`, and `prove_refund_comparison`, with a text registration state and registered count. Tool names remain visible when unavailable, but the UI must not imply they registered.

The staging ledger may be described as external to the browser session and read separately from the WebMCP response. Do not call it a payment-provider record, independent third party, production integration, or production proof.

### Human-agent handoff

Use one phase-aware `Next` strip between the Agent tools surface and the four-stage path. It is the single live workflow announcement and must expose a stable `data-next-action` value:

| State | Accessible name | Next action | Visible guidance |
|---|---|---|---|
| WebMCP unavailable | `Workflow blocked` | `enable-webmcp` | Open the page in a capable browser; supporting UI examples remain available |
| Idle | `Next actor: Agent` | `stage` | Send the instruction; the agent resets the external target, requires a zero-effect baseline, and stops for approval |
| Awaiting approval | `Next actor: Human` | `approve` | Review the exact values and approve; the agent waits |
| Approved or unstarted lane | `Next actor: Agent` | `deliver` | Return to the agent and say continue, or start the remaining lane |
| One delivery in a lane | `Next actor: Agent` | `retry` | Retry once with the identical request ID and values |
| Both lanes have two deliveries | `Next actor: Agent` | `prove` | Call `prove_refund_comparison`; do not deliver again |
| Proof ready | `Workflow complete` | `complete` | Unsafe created two refunds; protected created one; no further action |

The strip must update even when the domain phase remains `running`, because lane attempt counts distinguish deliver, retry, and prove. Do not duplicate these announcements in a second hidden live region.

### Agent prompt

Show a short plain-language summary first, followed by a collapsed `View exact WebMCP instructions` disclosure whose selectable steps follow the current trial state. A fresh run must:

- call `stage_refund_comparison` with `{}`;
- wait for visible human approval;
- call `issue_refund` twice for `broken` and twice for `protected` with the exact payment, amount, currency, and request ID;
- identify `PROVIDER_ACK_LOST_AFTER_COMMIT` as the expected first-call result and require one retry with identical arguments;
- finish with `prove_refund_comparison` using `{}`.

After partial progress, omit completed deliveries so copying the current instruction cannot create a third call. The exact instruction may be detailed because it is the executable judging path, but it remains collapsed until requested. Show a dedicated 44 px `Copy agent instruction` control only when the agent acts next, with visible success/failure feedback, and keep the full instruction selectable whenever native registration is ready.

The interface must not provide buttons that stage, deliver, or prove the comparison. Those actions belong to the three registered WebMCP tools. Human approval is the hero's only workflow action; copying the prompt is a non-mutating utility.

### Four-stage path

1. `You + agent` — Send prompt; reset staging
2. `You` — Approve the $42 staging fixture
3. `Agent` — Runs both retry versions
4. `Action Check` — Shows 2 refunds vs 1

Each stage needs a text state in addition to color: waiting, current, or complete.

### Human checkpoint

Before staging, show `Waiting for the agent to reset a staging trial` and make target invocation visibly blocked. If reset cannot prove a matching zero-effect baseline for both lanes, do not render an approval control.

After staging, show:

- payment;
- amount and currency;
- request ID;
- approval state;
- one primary control: `Approve exact staging refund`.

Copy must explain that approval is bound to the displayed values and that a changed request requires approval again. Never let an agent tool call produce the approved state.

### Comparison lanes

Show both lanes throughout the flow:

| Lane | Label | Expected evidence after two calls |
|---|---|---|
| Broken | `Negative control` / `Unsafe retry` | 2 tool calls, 2 refunds created, refunded twice |
| Protected | `Protected target` / `Protected retry` | 2 tool calls, 1 refund created, refunded once |

After the first call, show that the staging effect committed but its acknowledgement was lost. After the second, show whether the external observation found a new effect or the existing effect was reused. Invocation claims must not populate effect counts.

### Final proof

The proof panel appears only after both lanes receive exactly two approved calls and fresh external observations contain the expected `2/2` versus `2/1` effect records.

Required label and title: `Checker validated` / `Caught the unsafe duplicate. Protected stayed single.`

The panel must show:

- broken calls and effects;
- protected calls and effects;
- `external staging ledger read separately from the WebMCP response` as the evidence source;
- a clear known-bad `FAIL (expected)` and protected `PASS` result;
- the staging deployment identity, exact observed effect IDs, and evidence digests in the proof binding.

The result means the checker distinguished broken and protected behavior in the synthetic staging target. The known-bad lane failing is expected; the overall checker pass does not mean a real refund was safe.

## Default WebMCP surface

Technical details and submission captures must identify exactly these default tools:

```text
stage_refund_comparison → issue_refund → prove_refund_comparison
```

All three are Action Check-owned fixture tools. The separately served Worker is their HTTP outcome plane, not a second WebMCP registration surface.

Behavioral requirements:

- `stage_refund_comparison` calls the target reset adapter, verifies matching run capabilities and zero-effect baselines, then creates a fixed trial that awaits human approval.
- `issue_refund` requires the exact approved payment, amount, currency, and request ID.
- Each lane accepts at most two deliveries.
- Each delivery calls the fixed external invoke route, then reads the lane through the separate observe route. The invoke response contains no effect IDs or counts.
- The first delivery commits, the staging target reports an uncertain acknowledgement, then the tool returns a bounded `PROVIDER_ACK_LOST_AFTER_COMMIT` result after the separate observation endpoint confirms the commit.
- The broken retry creates a second effect.
- The protected retry reuses the first effect.
- `prove_refund_comparison` performs fresh observations, requires the known-bad lane to have two effects and the protected lane one, then commits the visible proof and receipt state.
- Replacing a trial or closing the session calls cleanup for both opaque run capabilities; short leases are the expiry backstop.
- Cancellation and page teardown fail closed.

The optional `run_external_target_canary` tool may appear only after the same-origin probe validates the exact isolated staging deployment. It exposes no target, account, content, provider, environment, credential, or URL selection.

## Supporting synthetic suite

The suite contains four cross-industry examples:

| Industry | Label | Synthetic action | Plain requirement |
|---|---|---|---|
| Travel | `Booking changed after approval` | `confirm_booking` | A changed quote must stop the booking |
| Payments | `Refund retried twice` | `issue_refund` | Two calls must create one refund |
| Cloud | `Deploy said done, state unchanged` | `deploy_service` | An unhealthy service must reject the success claim |
| Social | `Post said live, stayed draft` | `publish_post` | Draft state must reject the success claim |

Keep the judge-facing disclosure that these supporting fixtures use page controls and are not registered agent tools. Do not show internal scope-defence copy about External Target.

These fixtures are UI-run supporting examples, not additional default WebMCP registrations.

### Supporting flow

The visible stages remain:

1. `Define contract`
2. `Inject fault`
3. `Run tool`
4. `Check state`

Use plain labels in the main view:

- panel title: `What this test checks`;
- summary rows: `Before`, `Action`, and `Pass only if`;
- disclosure: `Show all 7 technical checks`;
- negative control: `Prove this test catches the bug`;
- recovery after the bug is caught: `Run safe version`.

The seven technical fields stay collapsed by default. Do not use their internal type name as the primary product explanation.

### Supporting results

Always separate:

- **Check result:** whether the declared rule passed;
- **Observed outcome:** whether the expected effect happened, an unsafe action was blocked, or a false success was caught;
- **Sensitivity check:** whether deliberately removing the protection caused the test to fail.

A success-shaped response cannot pass without the final state read. For false-success cases, say `Unchanged — false success caught`; do not present the unchanged business goal as a successful external action.

## External Target strip

Show the strip only on the social fixture.

- Default: `Optional staging integration` / `Optional external-target staging · disabled`; no run button. Explain that the lower case remains a UI-only synthetic fixture.
- Ready: show `Run staging check` only after exact attestation succeeds.
- Running: explain that the check uses isolated staging and no social network.
- Passed: show false claim rejected and truthful control accepted.
- Failed or inconclusive: state that Action Check did not obtain a safe proof.

The synthetic suite must never trigger this canary.

## Component responsibilities

- `RefundProofHero`: native state, always-visible three-tool surface, agent prompt, human approval, two lanes, and final proof.
- `HttpRefundEffectTarget`: strict fixed-route browser adapter for reset, invoke, observe, and cleanup. It requires HTTPS outside loopback and rejects redirects, oversized bodies, and malformed target evidence.
- `refund-staging-target` Worker: separately deployed synthetic outcome plane with exact-origin CORS, opaque expiring run capabilities, and per-lane SQLite Durable Object state.
- `ScenarioSuite`: four selectable supporting fixtures and per-case status.
- `TestPath`: the supporting suite's four stages.
- `VerificationRulePanel`: plain three-row summary with technical checks collapsed.
- `FaultPanel`: injected condition, target action, pass rule, and run controls.
- `ReportPanel`: verdict, observed outcome, sensitivity result, metrics, and event trace.
- `ExternalTargetCanaryPanel`: disconnected, ready, running, or proven staging state.
- `TechnicalDetails`: supporting-fixture IDs, evidence source, execution path, and report download. Native registration state belongs in the always-visible refund hero.

## Layout and visual system

- Desktop: a 300 px supporting-suite rail with a fluid main surface.
- Below 1120 px: stack verification and fault panels.
- Below 820 px: turn the suite rail into a horizontal selector.
- At and below 560 px: keep the Agent tools strip in the first viewport, wrap refund-path detail text, and preserve the approval, lanes, results, and technical details in semantic order with no horizontal overflow.
- Prefer ruled rectangular sections, tight spacing, and strong hierarchy over floating cards, decorative gradients, or heavy shadows.

Tokens:

```css
--canvas: #070b0d;
--surface: #0b1115;
--surface-raised: #0f171c;
--surface-selected: #16222b;
--text: #f2f3ed;
--text-soft: #aeb9cb;
--text-muted: #78869c;
--line: #34404a;
--line-strong: #5b6874;
--lime: #c8f31d;
--amber: #f4aa38;
--red: #ff6b5f;
--blue: #6eb5ff;
```

- Display labels: condensed industrial sans.
- Body and controls: readable humanist sans.
- Tool names, IDs, and metrics: monospace.
- Corners: 0–4 px.
- Lime means ready or passed, amber means attention or running, and red means blocked or failed.
- Never communicate status by color alone.
- Motion must be short and disabled by `prefers-reduced-motion`.

## Accessibility

- Preserve semantic headings, ordered paths, definition lists, and real buttons.
- Use polite, atomic status announcements for native state and supporting PASS/FAIL verdicts. Negative-control announcements must include the sensitivity result; do not duplicate the hero's existing focus and proof announcement.
- Approval, run, suite, and disclosure controls need visible keyboard focus and a minimum 44 px target.
- Every lane and suite status needs text, not color alone.
- Do not render the approval button before a current trial exists.
- Do not expose proof before the full ledger comparison exists.
- Verify desktop and mobile with automated accessibility checks and a keyboard-only pass.

## Truth boundary

- Label the refund provider, ledger, lane records, and all four fixtures as synthetic.
- It is accurate to say the refund hero observes a separate staging service. Do not imply that service is a payment processor, an independent provider, or a source of customer refunds.
- Do not claim that `issue_refund` belongs to or tests another WebMCP team. It is Action Check's own registered fixture used to prove the external-observation pattern.
- Do not claim general exactly-once execution.
- Do not imply that WebMCP supplies authorization, durable execution, idempotency, or postcondition verification automatically.
- State that the external target is implemented and locally verified but not publicly deployed. A production build requires `VITE_REFUND_STAGING_TARGET_URL` pointing to its exact HTTPS origin.
- Describe the External Target adapter as implemented but disconnected.
- Do not claim a live External Target run until the upstream service, isolated database, worker, independent sink, and go-live evidence exist.
- Do not use historical OAuth or pre-refund-hero screenshots in the final submission.
