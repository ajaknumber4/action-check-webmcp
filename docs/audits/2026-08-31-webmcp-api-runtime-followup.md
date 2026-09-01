# WebMCP API runtime follow-up

**Evidence date:** 2026-08-31
**Scope:** current official WebMCP sources and this repository's browser adapter

## Decision

Keep `document.modelContext` as the only production API path. Do **not** add a silent `document.modelContext ?? navigator.modelContext` fallback for the submission.

`navigator.modelContext` was a real earlier API shape, so the idea is not invented. It is, however, obsolete as the current WebMCP surface: the getter was deliberately moved from `Navigator` to `Document`, the change was merged, and the live draft defines only `Document.modelContext`. A navigator fallback is therefore a legacy compatibility shim, not evidence of current WebMCP support.

## Primary-source evidence

- The [current WebMCP Community Group draft](https://webmachinelearning.github.io/webmcp/#extensions-to-document) extends `Document` with a secure, same-object `modelContext` getter and defines registration as `document.modelContext.registerTool(...)`. It contains no corresponding `Navigator` extension. The report is dated 26 August 2026 and explicitly remains a Community Group report rather than a W3C Standard.
- The specification issue [“Make tools Document-scoped instead of Window-scoped”](https://github.com/webmachinelearning/webmcp/issues/173) records why the older `navigator.modelContext` placement was unsafe across navigation and recommends `document.modelContext`.
- The WebMCP repository's [merged PR #184](https://github.com/webmachinelearning/webmcp/pull/184) moved the getter to `Document` on 27 May 2026. This makes the change adopted project history, not an open proposal.
- The [official WebMCP README](https://github.com/webmachinelearning/webmcp#imperative-tool-registration-documentmodelcontext) and Chrome's current [Imperative API guide](https://developer.chrome.com/docs/ai/webmcp/imperative-api) both teach registration, discovery, execution, events, and lifecycle through `document.modelContext`. Chrome also labels the API an origin trial and subject to change; neither source presents navigator fallback as part of the current contract.

## Adapter comparison

The current adapter is aligned with that surface:

- [`browser-model-context.ts`](../../src/adapters/webmcp/browser-model-context.ts) reads only `documentLike.modelContext` (`72–79`) and calls its `registerTool` with an `AbortSignal` (`100–106`).
- It fails closed when the API is absent, the context is insecure, or the page is not top-level. The top-level restriction is an application safety policy; WebMCP itself can support permitted iframe registrations.
- It does not inspect `navigator.modelContext`. That is correct for the current draft and current Chrome documentation.

If a specifically named legacy browser becomes an explicit requirement, add a separately labelled legacy adapter with a version-pinned compatibility test. Do not broaden normal detection with an unverified fallback or describe it as cross-client WebMCP support.

## Judging-client evidence gap

The repository has strong browser-runtime evidence but not judge-agent evidence. [`webmcp-native.spec.ts`](../../tests/native/webmcp-native.spec.ts) verifies `document.modelContext` in installed Chrome 151, observes native tool registration through Chrome DevTools Protocol, and invokes `getTools()` / `executeTool()` in page JavaScript. [`QA_EVIDENCE.md`](../QA_EVIDENCE.md) correctly records that interactive discovery in the named judging client is still unestablished.

That distinction matters because the [draft makes browser-agent observation implementation-defined](https://webmachinelearning.github.io/webmcp/#page-observations): it does not prescribe how or when a browser exposes registered tools to its agent. Passing Chrome's page API cannot prove that the exact judge-facing agent sees or can invoke the tools.

**Required release evidence:** on the deployed HTTPS build, record the exact judging client and version discovering all three tool names, then successfully calling `stage_refund_comparison`, `issue_refund` (including the pre-approval rejection), and `prove_refund_comparison`. If that client exposes only `navigator.modelContext`, treat it as a documented legacy-client exception and test it explicitly; do not infer support from a fallback alone.
