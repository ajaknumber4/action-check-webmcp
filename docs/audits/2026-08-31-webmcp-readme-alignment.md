# WebMCP README/spec alignment audit

> **Superseded implementation snapshot.** This audit identified the missing registered target and native human-agent journey in the earlier six-tool workbench. Those structural gaps are now resolved by the three-tool refund comparison documented in `README.md`, `SCOPE.md`, and `docs/QA_EVIDENCE.md`. The analysis below is retained as decision history; its present-tense implementation claims and prescribed tool sequence are not current release evidence.

Date: 2026-08-31

## Verdict

**Action Check is strongly aligned with the problem described by WebMCP, but the current demo only partially proves that it tests WebMCP tools.**

The strongest primary-source support is unusually direct: the WebMCP specification says there is no guarantee that a tool's declared intent matches its behavior and lists "no verification mechanism" and "no behavioral contracts" as current gaps. Action Check's effect contracts, false-success checks, and post-action state evidence address that gap. [WebMCP specification §6.3.2](https://webmachinelearning.github.io/webmcp/#misrepresentation-of-intent)

The credibility problem is local, not conceptual. The project calls itself "Effect tests for mutating WebMCP tools," but its four synthetic target actions (`issue_refund`, `confirm_booking`, `deploy_service`, and `publish_post`) are fixture labels rather than registered WebMCP tools. The registered tools control the workbench. That makes the implementation a valid WebMCP-powered developer workbench, but it does not yet demonstrate an actual mutating WebMCP tool being invoked and then independently checked.

Recommended positioning:

> **A same-origin WebMCP assurance harness that closes the specification's declared intent-verification gap with executable effect contracts.**

## Official model to meet

WebMCP is a browser-native alternative to backend tool integrations. A page exposes existing JavaScript functionality as described, schema-driven tools; an agent discovers and invokes those tools while the user, UI, browser state, authentication, and application logic remain together. Its stated goal is cooperative, human-in-the-loop work in the active browser, not headless or fully autonomous operation. [WebMCP README — Background and Motivation](https://github.com/webmachinelearning/webmcp/blob/main/README.md#background-and-motivation), [Goals and Non-Goals](https://github.com/webmachinelearning/webmcp/blob/main/README.md#goals--non-goals)

The current imperative API is `document.modelContext`: `registerTool()`, `getTools()`, `executeTool()`, and `toolchange`. A tool can include `name`, `title`, `description`, JSON `inputSchema`, `execute`, `readOnlyHint`, and `untrustedContentHint`; registration and execution support cancellation with `AbortSignal`. It is secure-context-only and origin/Permissions-Policy mediated. [Rendered specification §4](https://webmachinelearning.github.io/webmcp/#api)

The official examples keep material changes visible: design edits are staged for review, checkout remains a human completion step, product filtering updates the visible UI, and a Gerrit edit is left for a developer to accept, alter, or reject. [WebMCP README — Use Cases](https://github.com/webmachinelearning/webmcp/blob/main/README.md#use-cases)

## Implementation comparison

| Area | Assessment | Local evidence | Consequence |
|---|---|---|---|
| Imperative registration | **Aligned** | `src/adapters/webmcp/browser-model-context.ts` calls `document.modelContext.registerTool()` and `src/app/App.tsx` registers the six workbench tools. | Uses the intended page-side provider model. |
| Tool dictionary | **Aligned** | `src/adapters/webmcp/model-context-registrar.ts`, `tool-schemas.ts`, and `register-workbench-tools.ts` provide names, titles, descriptions, JSON Schemas, callbacks, and both current annotations. | Matches the current draft surface. |
| Lifecycle and cancellation | **Aligned** | Registration is tied to an `AbortController`; invocation forwards `options.signal`; disposal aborts registrations. | Matches the draft's lifecycle and cancellation model. |
| Secure/origin boundary | **Aligned, conservative** | Registration requires a secure top-level document and omits `exposedTo`, preserving the default same-origin boundary. | Stricter than the draft, which also permits same-origin frames; appropriate for this harness. |
| Input/output hardening | **Stronger than minimum** | Strict Zod validation, `additionalProperties: false`, 80-character IDs, bounded metadata, 1,500-character results, redaction, and `untrustedContentHint` are implemented. | Sensible because native schema validation remains an open design question and the spec identifies output injection risk. [README — Open Questions](https://github.com/webmachinelearning/webmcp/blob/main/README.md#open-questions), [spec §6.4.3](https://webmachinelearning.github.io/webmcp/#untrusted-annotation-for-tool-responses) |
| Shared UI/application state | **Partly aligned** | WebMCP tools and the UI share the same workbench session and command layer. However, the main `Run test` button calls that layer directly. | Code reuse is valid, but a judge can use the whole product without WebMCP. |
| Human-agent control | **Partly aligned** | The WebMCP path blocks `replay_flow` until human approval. The visible one-click path stages and immediately confirms the patch inside one handler (`src/app/WorkbenchPage.tsx`). | The strongest official interaction pattern—agent stages, human inspects/approves, agent continues—is hidden. |
| Actual tool under test | **Major gap** | `README.md` explicitly says synthetic action names are not registered browser tools; the six registered tools operate the runner. | The headline currently overstates what is exercised end to end. |
| Native test | **Partial proof** | `tests/native/webmcp-native.spec.ts` proves registration and several invocations. It proves `replay_flow` is blocked without approval, then uses the ordinary UI to complete the run and calls only `prepare_report` through WebMCP afterward. | No successful consequential replay currently completes through the native WebMCP path. |
| External integration | **Incomplete by design** | `run_social_neuron_canary` is exposed only after staging attestation, while the README truthfully says the upstream staging system is not deployed. | Safe and honest, but it cannot presently supply real-world outcome evidence. |

## Required corrections before presenting this as an effect tester for WebMCP tools

### P0 — Put a real registered WebMCP target in the hero path

Use the duplicate-refund fixture as the minimal end-to-end proof:

1. Register a browser-local `issue_refund` target tool with a strict schema and visible fixture state.
2. Let the fault injector switch that target between deliberately broken and protected implementations.
3. Invoke the registered target through a WebMCP agent/client, not through an internal function call.
4. Read authoritative fixture state independently and show: broken retry produces two effects; protected retry produces one.
5. Produce the receipt through the registered workbench surface.

This can remain synthetic. The essential correction is that the action under test must genuinely cross the browser's WebMCP registration/invocation boundary.

### P0 — Make the successful human-agent sequence explicit

The native demo and test should show:

`read_case` → `run_diagnostics` → `stage_sandbox_fix` → **visible human review and approval** → `replay_flow` through WebMCP → `prepare_report`.

Do not let the hero button silently issue both the human approval and the agent replay. The official model emphasizes shared visibility and user control, and the Gerrit/design examples stage changes before a person accepts them. [WebMCP README — Use Cases](https://github.com/webmachinelearning/webmcp/blob/main/README.md#use-cases)

### P1 — Resolve draft/API compatibility evidence

The current native test calls `executeTool(tool, JSON.stringify(args))`. The current draft signature is `executeTool(tool, inputObject, options)`. A passing installed-Chrome test therefore proves compatibility with that browser build, not conformance to the current draft. Update the test when the installed implementation supports the object signature, or feature-detect/document the draft version being exercised. [WebMCP specification §4.2](https://webmachinelearning.github.io/webmcp/#modelcontext-interface)

### P1 — Document the judging runtime

The official implementation-status file currently lists ChatGPT Desktop support, Chrome 149 and Edge 150 origin trials, and experimental Brave support; it makes no supported claim for Firefox or Safari. The public demo and README should identify the exact tested client and any activation requirement. [Official implementation status](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md)

### P1 — Tighten the claim

Lead with the gap the specification actually names: declared intent versus actual behavior, no verification mechanism, and no behavioral contracts. Present duplicate effects, stale approvals, and false success as concrete failure modes Action Check detects—not as guarantees WebMCP claims to provide or as defects unique to WebMCP.

## What should not be added merely for compliance

- Declarative form tooling is optional and still incomplete in the draft; this application legitimately needs imperative JavaScript tools. [Declarative API explainer](https://github.com/webmachinelearning/webmcp/blob/main/declarative-api-explainer.md)
- Cross-origin discovery is unnecessary and would weaken the safety story. The credible scope is a same-origin harness or explicitly attested staging adapter.
- Full autonomy would conflict with the stated human-in-the-loop design. Preserve explicit approval for consequential replay.
- A production Social Neuron connection is not required to prove API alignment. It is an impact/credibility enhancement and must remain truthfully labelled until deployed.

## Submission-level conclusion

**Suitable, after one structural correction:** make the duplicate-refund demonstration execute an actual registered WebMCP target and complete the successful replay through WebMCP after visible human approval. Without that correction, Action Check is a thoughtful browser safety workbench with a WebMCP adapter. With it, the project becomes direct executable evidence for a trust gap the WebMCP specification itself declares.

## Primary sources

- [WebMCP repository README](https://github.com/webmachinelearning/webmcp/blob/main/README.md)
- [WebMCP Draft Community Group Report](https://webmachinelearning.github.io/webmcp/)
- [WebMCP source specification (`index.bs`)](https://github.com/webmachinelearning/webmcp/blob/main/index.bs)
- [WebMCP implementation status](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md)
- [Declarative WebMCP explainer](https://github.com/webmachinelearning/webmcp/blob/main/declarative-api-explainer.md)
