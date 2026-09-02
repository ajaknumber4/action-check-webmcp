# Title

**Action Check**

## One-line Summary

Verify what a WebMCP action actually changed—catching duplicate effects, stale approvals, and false success before production.

## Problem

WebMCP lets a website expose structured tools that an agent can discover and call. A valid tool schema explains how to make the call, but it does not prove that a mutating tool produced the intended effect.

A refund tool can return `success` after creating two refunds. A booking can execute against details that changed after approval. A deployment or publishing tool can claim completion while the authoritative state remains unchanged. These failures are difficult to spot when an agent or user sees only the handler response.

The WebMCP draft itself identifies the gap between declared intent and actual behavior, including the absence of a general verification mechanism and behavioral contracts. Action Check turns that trust gap into an executable, visible test. Source: [WebMCP specification, Misrepresentation of Intent](https://webmachinelearning.github.io/webmcp/#misrepresentation-of-intent).

## Solution

Action Check is a browser-based test lab for consequential WebMCP actions. This entry proves the pattern with an Action Check-owned refund fixture backed by a separately served synthetic staging Worker. A person reviews and approves the exact trial on the page. An agent then runs the registered fixture tool through WebMCP, and Action Check compares its claim with the Worker's durable effect state. The approval control is deliberately unavailable to the agent.

A phase-aware handoff strip keeps the person and agent coordinated: it names who acts next, tells the agent when to stage, deliver, retry, or prove, and tells the person when to approve or return to the agent and say continue.

The hero demonstration compares two implementations of a synthetic refund retry:

1. The agent calls `stage_refund_comparison` to reset isolated broken and protected staging runs and prove both start with zero effects.
2. The page shows the exact synthetic payment, amount, currency, request ID, and trial reference.
3. A person approves that exact trial using the visible interface. Approval is intentionally not available as an agent tool.
4. The agent calls Action Check's registered `issue_refund` WebMCP fixture twice for each lane with the approved arguments.
5. The broken lane records **2 calls / 2 effects**. The protected lane records **2 calls / 1 effect** because it reuses the same logical request identity.
6. The agent calls `prove_refund_comparison`, which performs fresh reads from leased SQLite Durable Objects and produces a receipt bound to the approved trial digest, request ID, staging deployment, generated UUID effect IDs, and evidence digests. The `issue_refund` response contains no effect counts or IDs and cannot make the test pass by itself.

Everything in this hero flow is fictional. The effects live in an external synthetic staging Worker rather than page memory, but the Worker is part of Action Check—not a payment provider or another team's independently registered WebMCP tool. No real payment changes.

The existing workbench also demonstrates four cross-industry failure modes using deterministic synthetic fixtures:

- Travel: booking details change after a person approves them.
- Payments: a lost response causes a refund retry and duplicate effect.
- Cloud operations: a deployment claims success while the service remains unhealthy.
- Publishing: a post claims to be live while it remains a draft.

The external-target staging integration is **not connected and is not part of the hero demonstration**. The submission must not imply otherwise.

## Why This Matters

Agents become more useful when they can act, but the cost of a convincing false success rises with every consequential tool. Application teams need to know whether approval stayed current, retries were idempotent, and the requested real outcome actually occurred.

Action Check demonstrates a practical human-agent division of responsibility:

- The website owns the tool implementation, browser context, UI, and effect evidence.
- The agent discovers the typed workflow, stages the test, invokes the target, and requests proof.
- The person sees and approves the exact consequential trial.
- Fresh durable evidence—not the agent's opinion or the action's return message—decides the result.

WebMCP is central to the hero path because `issue_refund` is an actual Action Check-registered fixture tool, not merely a label or an internal button handler. The same browser page contains the human review surface and tool boundary, while a separate Worker holds the effect evidence. This version proves the architecture with our fixture; it does not yet automatically test tools registered by another team's site.

## How We Used AI

### In the product

An AI agent uses WebMCP tool discovery and invocation to operate the staged comparison. None of the registered tools can approve the trial or declare the outcome successful. The demonstration keeps approval in a visible person-operated page control, while fresh external observations constrain what counts as a pass. A separate browser automation agent could still click ordinary page controls; Action Check does not claim WebMCP prevents that.

The intended collaboration is:

`agent stages trial → person reviews and approves → agent invokes target → harness proves effects`

This preserves the cooperative, human-in-the-loop model described by WebMCP while making the resulting behavior testable.

### During development

AI-assisted research and critique were used to compare the concept with the official WebMCP README and specification, challenge whether WebMCP was genuinely necessary, reduce unclear product copy, and identify the missing end-to-end proof: the synthetic target action itself needed to be a registered WebMCP tool.

OpenAI Codex was used for research synthesis, implementation, testing, browser verification, design iteration, and documentation. With the participant's explicit approval, Anthropic Fable performed a read-only independent design regression against the saved baseline, fresh desktop/mobile state captures, and a restricted public UI source set. That review upgraded the overall design from B to B+ and found one P1 release issue: the human-approval CTA clipped in the 1280px judge path. Codex reproduced that defect with a real-browser geometry assertion, fixed the approval breakpoint, and recaptured the approval and proof states at 1280×900 and 375×667.

## How We Used Codex

Codex supported the project as a build and review partner by:

- inspecting the evolving repository and tracing the actual registered WebMCP boundary;
- comparing the implementation with the official WebMCP repository and draft specification;
- adversarially reviewing the use case, positioning, and judging risks;
- implementing and refactoring the React, TypeScript, WebMCP adapter, deterministic fixture, approval, and proof paths;
- implementing the external Cloudflare Worker, SQLite Durable Object state, leased capabilities, reset allocation guard, and invoke/observe reconciliation path;
- creating unit, DOM, browser, accessibility, and native WebMCP tests;
- running regression checks and identifying claims that still required live evidence;
- documenting the security boundary, synthetic-data limitation, and disconnected staging integration.

**TODO before final entry:** include a Codex session ID only if the live Devpost form asks for one and the participant confirms the correct session.

## Key Features

- **A real registered fixture tool:** Action Check's `issue_refund` is invoked across the browser's WebMCP boundary in the hero comparison. It is not another team's independently registered tool.
- **Three-tool agent path:** `stage_refund_comparison`, `issue_refund`, and `prove_refund_comparison` create a compact, discoverable judging flow.
- **Judge-visible WebMCP surface:** the page always lists the three agent tools and their truthful native registration state.
- **Truthful staging state:** the hero says `WebMCP fixture · external staging` and labels the target `Configured`, not ready, until a successful reset proves reachability and zero baselines.
- **Exact human approval:** execution is blocked until a person approves the displayed trial reference and bound payment fields.
- **Broken-versus-protected comparison:** the same lost-response retry produces two effects in the broken lane and one effect in the idempotency-protected lane.
- **Response-independent evidence:** fresh reads from leased SQLite Durable Objects establish the post-action effect; `/v1/invoke` returns no effect evidence.
- **Bounded external staging:** opaque short-lived run capabilities, an exact two-invocation Durable Object ceiling, exact-origin CORS, and a pre-allocation reset rate-limit guard constrain the synthetic Worker.
- **Strict, bounded schemas:** registered tools accept only the documented synthetic inputs and reject mismatches.
- **Visible shared state:** the person and agent work against the same page-owned trial and proof state.
- **Cross-industry breadth:** four deterministic fixtures cover stale approval, duplicate effects, and false success in travel, payments, cloud operations, and publishing.
- **Negative controls:** supporting workbench cases can deliberately remove a protection so the test must catch the resulting failure.
- **Fail-closed staging boundary:** an optional external-target adapter remains unavailable unless an isolated staging service supplies the required attestation. The current UI labels it as an optional disabled integration rather than a working feature.

**Verification status:** the release passes 21 app test files / 140 tests, 1 Worker file / 11 tests plus generated bindings, types, local and production Wrangler dry-runs, 16/16 desktop/mobile browser journeys with Axe and keyboard assertions, a production build, and 1/1 installed-Chrome native WebMCP journey. The same 16 browser journeys and native journey pass against the stable public URL. An interactive ChatGPT in-app-browser run completed reset → visible approval → four invokes → proof with outcomes `ACK_LOST`, `ok`, `ACK_LOST`, `ok`, observed **2 versus 1**, and zero console/page warnings or errors.

## Architecture

Action Check uses the imperative `document.modelContext` API from the active top-level page.

### Hero path

- `src/refund-comparison/` owns the serialized comparison session, exact approval binding, and invoke-loss reconciliation state machine.
- `src/adapters/webmcp/register-refund-comparison-tools.ts` registers the three hero tools with strict JSON schemas, lifecycle cancellation, and tool annotations.
- `stage_refund_comparison` resets two leased external runs, requires zero-effect baselines, and creates an immutable trial reference.
- A page-owned human control approves the exact current trial. Editing or restaging invalidates earlier approval.
- `issue_refund` is Action Check's mutating WebMCP fixture. It invokes the configured Worker and then observes that lane separately. The browser session serializes calls, and each Durable Object independently accepts only two deliveries with the approved payment, amount, currency, and request ID.
- The broken lane creates a new synthetic provider refund on both deliveries. The protected lane reuses the first effect on the retry.
- `prove_refund_comparison` performs fresh external observations and withholds proof until the known-bad run contains `2/2` and the protected run `2/1`. It binds the generated UUID effects and evidence digests, then commits visible proof, so its WebMCP annotation truthfully marks it as state-changing.
- `workers/refund-staging-target/` supplies the separate synthetic outcome plane with leased SQLite Durable Objects, exact-origin CORS, a reset rate-limit binding, cleanup, and a strong two-invocation ceiling per run.

### Supporting workbench

- Immutable fixture and effect-contract modules describe the four cross-industry cases.
- A shared application command layer supports both the human UI and registered workbench tools.
- The React interface renders the contract, injected failure, approval state, execution trace, and resulting evidence.
- The optional external-target adapter is isolated behind a same-origin broker and exact staging attestation, but the required upstream staging system is not deployed or configured.

The four supporting action names are synthetic scenarios. The refund hero proves a real invocation of Action Check's own registered WebMCP fixture end to end; it does not establish that the project can already attach to another site's independently registered tool. The final entry must not claim that the four supporting actions are native targets.

## Testing Instructions

### Judge path using WebMCP

1. Open **https://action-check-webmcp.vercel.app/** in the ChatGPT desktop in-app browser, where WebMCP is enabled by default. The same path was also verified in Google Chrome **152.0.7977.65** with `chrome://flags/#enable-webmcp-testing` enabled.
2. Ask the agent to list the page's WebMCP tools. Confirm that it discovers `stage_refund_comparison`, `issue_refund`, and `prove_refund_comparison`.
3. Confirm the page describes the target as **Configured**, not ready, then ask the agent to call `stage_refund_comparison` with an empty object. Only a successful zero-baseline reset establishes reachability.
4. In the visible page, review the fictional payment, amount, currency, request ID, and trial reference. Use the human approval control.
5. Ask the agent to call `issue_refund` twice for the `broken` lane using the exact approved arguments. The first call should report that the synthetic provider committed and the harness deliberately dropped its acknowledgement; the retry should create a second synthetic refund.
6. Ask the agent to call `issue_refund` twice for the `protected` lane using the same approved logical request. The first provider acknowledgement is again deliberately dropped; the retry should reuse the existing synthetic refund.
7. Ask the agent to call `prove_refund_comparison` with an empty object.
8. Confirm the visible and returned evidence reports:
   - broken: **2 calls / 2 provider refunds**;
   - protected: **2 calls / 1 provider refund**;
   - evidence source: **external staging ledger read separately from the WebMCP response**;
   - receipt binding: the approved trial digest, request ID, staging deployment, generated UUID effect IDs, and evidence digests;
   - production effects: **none**.
9. Optionally use the visible case selector to inspect the travel, cloud, and publishing fixtures. These supporting cases are synthetic breadth demonstrations, not live external integrations.

### Local verification for reviewers

Requirements: Node.js 22.x.

```sh
npm ci
npm --prefix workers/refund-staging-target ci
npm run ci:check
npm run test:e2e
npm run test:native-webmcp
```

**Release evidence (2026-09-01):** 21 app files / 140 tests; 1 Worker file / 11 tests plus generated bindings, TypeScript, and Wrangler dry-runs; 16/16 Playwright desktop/mobile journeys with Axe and keyboard assertions against local and deployed paths; production build passed; 1/1 native discovery-and-invocation journey passed locally and against production in installed Chrome 152. The interactive ChatGPT in-app-browser journey completed the expected `ACK_LOST`, `ok`, `ACK_LOST`, `ok` sequence, proved `2` versus `1`, and produced zero console/page warnings or errors.

## Public Demo Link

**https://action-check-webmcp.vercel.app/**

Requirements before replacing this placeholder:

- HTTPS and accessible without private network access.
- Opens successfully in the exact named judging client.
- Exposes the three hero WebMCP tools in that client.
- Uses `VITE_REFUND_STAGING_TARGET_URL` to reach the exact deployed HTTPS Worker, whose allowlist contains the frontend origin.
- Contains no credentials, personal information, real payment identifiers, or production integrations.
- Matches the commit and behavior shown in the video.

## Public Repository Link

**https://github.com/ajaknumber4/action-check-webmcp**

The repository must be public, include the complete release source and run instructions, visibly identify the MIT licence, and make the WebMCP registration code easy for judges to find.

Before publishing, run the repository's public-boundary and secret checks. A public push cannot be made private retroactively in a way that removes already exposed secrets.

## Demo Video

**TODO: PUBLIC YOUTUBE VIDEO URL**

Target: narrated, public, under three minutes, with the working result visible in the first 15 seconds.

### Suggested outline (approximately 2:35)

- **0:00–0:12 — Result and boundary:** show broken 2 calls / 2 effects beside protected 2 calls / 1 effect, with the visible Agent tools strip. State that the provider is synthetic and no money moves.
- **0:12–0:30 — Native discovery:** show the judging agent discovering all three WebMCP tools and calling `stage_refund_comparison`. Keep the names readable.
- **0:30–0:50 — Problem:** while the staged values appear, explain that a schema and `success` response cannot prove a mutating tool caused the correct effect.
- **0:50–1:10 — Human control:** a person reviews and approves the exact synthetic payment, amount, currency, request ID, and trial reference in the page.
- **1:10–1:45 — Registered target:** the agent invokes `issue_refund` twice in each lane. Show the lost first response and retry behavior.
- **1:45–2:05 — Effect proof:** the agent calls `prove_refund_comparison`; show the response-independent ledger counts and bound receipt.
- **2:05–2:20 — Breadth:** briefly show stale booking approval, false deployment success, and false publishing success as supporting UI-only synthetic cases.
- **2:20–2:35 — Value:** consequential WebMCP teams can adapt the same approval, retry, and postcondition checks to catch unsafe effects before production.

Do not show or claim a live external-target staging run. Remove setup delays, dead air, terminal installation steps, and unverified claims from the final cut.

## Screenshot Shot List

Capture all images from the final deployed build and final browser/client version. Existing historical screenshots should not be reused without confirming they match the release source.

1. **WebMCP discovery:** `docs/screenshots/action-check-live-discovery.jpg` shows the deployed three-tool surface and native-ready state.
2. **Awaiting human approval:** `docs/screenshots/action-check-live-approval.jpg` shows the exact fictional fixture and visible approval control.
3. **Outcome proof:** `docs/screenshots/action-check-live-proof.jpg` shows known-bad 2 calls / 2 effects beside protected 2 calls / 1 effect and the response-independent verdict.

`docs/screenshots/external-staging-refund-proof.png` remains local pre-release QA evidence and is excluded from the Devpost gallery.

## Submission Readiness Notes

### Present in the repository

- React and TypeScript application with deterministic synthetic fixtures.
- Imperative WebMCP adapters with strict schemas and lifecycle handling.
- Three-tool duplicate-refund hero implementation in the current working tree.
- Separately served synthetic staging Worker with SQLite Durable Objects and generated UUID effect evidence.
- Four supporting cross-industry cases.
- Automated unit, DOM, end-to-end, accessibility, and native-browser test infrastructure.
- MIT licence and public-boundary documentation.

### Must be verified after the hero path is frozen

- [x] Run the complete current-worktree regression: 140 app tests, 11 Worker tests, 16/16 desktop/mobile journeys, 1/1 native Chrome journey, and a production build passed.
- [x] Fix the 1280px human-approval CTA overflow, add a horizontal-overflow/containment regression assertion, and recapture desktop/mobile approval plus proof.
- [x] Rerun the release commands and record the final counts.
- [x] Confirm all three hero tools register in the ChatGPT desktop in-app browser and Chrome 152.
- [x] Complete a local app-to-Worker reset → visible approval → four invokes → response-independent proof journey with zero console/page errors.
- [x] Confirm the UI and returned evidence agree on 2/2 for the broken lane and 2/1 for the protected lane.
- [ ] Verify cancellation, stale approval, strict input binding, reset, and call-limit behavior in the final build.
- [x] Capture current deployed discovery, approval, and proof evidence.

### Missing external submission assets

- [x] Freeze the title as Action Check.
- [x] Deploy the synthetic staging Worker with the final identity, rate-limit namespace, lease, and exact frontend origin.
- [x] Build the frontend with the Worker's HTTPS origin and verify reset → invoke → observe → cleanup from that deployment.
- [x] Add and verify the public HTTPS live URL.
- [x] Publish the public repository from a sanitized release root.
- [ ] Record and publish the narrated YouTube video under three minutes.
- [x] Add three final deployed screenshots.
- [ ] Fill the participant-specific Devpost form choices.
- [ ] Verify the Devpost project is no longer a draft after the final submission step.

## Known Limitations

- The refund comparison is entirely synthetic. It uses an external durable staging Worker, but it does not call a payment provider or prove exactly-once behavior for a production payment system.
- The Worker and WebMCP fixture are both owned by Action Check. Their separation proves the pattern, not independent third-party attestation or compatibility with another team's registered tool.
- The reset rate limiter is a permissive, per-location abuse-pressure guard, not authentication or globally exact accounting. The strong safety bound is the exact two-invocation ceiling inside each run Durable Object.
- The four supporting cases prove reusable failure patterns with synthetic data. They are not evidence of four production integrations.
- External-target staging is not connected. Its endpoints, isolated database, worker lifecycle, and independent canary sink are not deployed or configured for this project, and it is excluded from the hero demo.
- The exact verified judging clients are the ChatGPT desktop in-app browser and Chrome 152 with WebMCP testing enabled; other draft implementations may differ.
- WebMCP is an evolving draft with client-specific implementation differences. The final testing instructions must name the exact verified client and version.
- The live URL, public repository, and three final deployed screenshots are present. The public narrated video, participant-specific form choices, and explicit final submit remain open.

## Official Form Fields

Live Devpost requirements were refreshed on 2026-08-31. The event requires a working judge-accessible URL, a public repository with a visible open-source licence, a public narrated YouTube demo under three minutes, and the custom fields below. Recheck the live form before the final write.

### Submitter type

**TODO: participant choice — do not infer.**

### Countries of residence

**TODO: participant choice — do not infer or prefill personal information.**

### Organization name (optional)

**TODO: complete only if submitting on behalf of an organization; otherwise leave blank.**

### App Status

**TODO: choose `New` or `Existing` based on the participant's truthful project history.**

If `Existing` is selected, adapt and verify this explanation:

> During the WebMCP Challenge submission period, the project was materially extended from an earlier browser workbench into Action Check: a WebMCP effect-testing fixture. The new work includes the Action Check-owned `issue_refund` registration, the three-tool broken-versus-protected hero flow, exact visible approval outside the registered tool surface, a separately served Durable Object outcome plane, cross-industry action fixtures, a redesigned interface, and expanded automated/native WebMCP evidence. Repository history confirms all implementation work began after the challenge opened; replace this paragraph only if the participant selects `Existing` and the live form requires it.

### Why this is a strong WebMCP fit

Action Check tests its own actual registered mutating fixture in the same page where a person reviews the action and sees its effects. WebMCP keeps agent discovery, typed invocation, page state, and human control together; durable effect records read separately from the invocation claim then check whether the fixture behaved as declared.

### What people and agents can do together

An agent can stage and execute a repeatable behavioral trial using structured page-owned tools. A person retains approval over the exact consequential inputs. Together they can distinguish a convincing tool response from the actual resulting state—without fragile DOM automation or giving the agent authority to approve itself.

### Brief WebMCP implementation explanation

The top-level page registers Action Check's `stage_refund_comparison`, `issue_refund`, and `prove_refund_comparison` fixtures through the imperative `document.modelContext` API. The target accepts a strict schema bound to a synthetic trial approved through a visible page control that is absent from the registered surface. A separately served Worker stores each run in a leased SQLite Durable Object. The proof tool performs fresh observations rather than trusting the invoke claim, then binds the receipt to the approval digest, request ID, deployment, UUID effect IDs, and evidence digests. The browser serializes stateful operations and reconciles uncertain invoke responses against the exact observed sequence.

### Live URL

**https://action-check-webmcp.vercel.app/**

### Testing instructions

Use the verified **Testing Instructions** section above. No credentials are required.

### Public repository

**https://github.com/ajaknumber4/action-check-webmcp**

### Agents/clients tested

- ChatGPT desktop in-app browser on macOS, tested 2026-09-01: WebMCP enabled by default; discovered and invoked all three tools through the complete live external-staging journey.
- Google Chrome 152.0.7977.65 on macOS, tested 2026-09-01: WebMCP testing enabled; 1/1 native discovery-and-invocation journey passed against the public URL.

### AI tools used

- OpenAI Codex — confirmed for research synthesis, repository analysis, implementation, testing, design iteration, adversarial review, and documentation.
- Anthropic Fable — confirmed for the participant-approved, read-only independent design regression against the saved baseline and restricted public UI evidence set.

### Learning level

**TODO: participant self-assessment — do not infer.**

### Career value of AI

**TODO: participant-authored answer.** Suggested topics: what the participant learned about trustworthy agent actions, how human approval and independent verification changed their approach, and how AI-assisted implementation/review affected the pace or quality of the work. Do not invent personal career claims.

### Demo video URL

**TODO: PUBLIC YOUTUBE VIDEO URL**

### Screenshot assets

- `docs/screenshots/action-check-live-discovery.jpg`
- `docs/screenshots/action-check-live-approval.jpg`
- `docs/screenshots/action-check-live-proof.jpg`

### Final proof checklist

- **DONE:** final title frozen as Action Check.
- **DONE:** public live URL verified in the ChatGPT in-app browser and Chrome 152.
- **DONE:** public repository created with visible MIT licence and complete release source.
- **DONE:** WebMCP registration code linked from the README architecture section.
- **DONE:** exact final test count and build result recorded.
- **DONE:** interactive agent discovery and complete hero invocation captured.
- **TODO:** public YouTube video under three minutes with clear audio.
- **DONE:** technical claims checked against the frozen release build; participant-authored claims remain pending.

### Live form field map

| Field ID | Official label | Required | Draft location |
|---:|---|:---:|---|
| 28249 | Submitter Type | Yes | Submitter type |
| 28250 | Country of residence of yourself and team members if applicable | Yes | Countries of residence |
| 28251 | If submitting on behalf of an organization, what is the organization name? | No | Organization name |
| 28252 | App Status | Yes | App Status |
| 28253 | If Existing, explain what you updated during the submission period. | No | Existing-project explanation |
| 28254 | Live URL judges can access in ChatGPT’s in-app browser or Chrome with WebMCP | Yes | Live URL |
| 28255 | Testing instructions / credentials if applicable | No | Testing instructions |
| 28256 | Public code repository URL | Yes | Public repository |
| 28257 | Agent(s) or client(s) used to test the WebMCP tools | Yes | Agents/clients tested |
| 28258 | AI tools leveraged while working on the project | Yes | AI tools used |
| 28259 | Learning derived from the project | Yes | Learning level |
| 28260 | Whether the participant gained reusable career value from AI | Yes | Career value of AI |
