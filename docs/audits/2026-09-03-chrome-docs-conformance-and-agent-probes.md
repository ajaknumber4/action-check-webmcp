# Chrome WebMCP docs conformance and off-script agent probes

**Date:** 2026-09-03 (runs between 01:50 and 12:10 BST; deadline 21:00 BST)
**Scope:** The live build at `https://action-check-webmcp.vercel.app/` (Vercel deployment from 2 September, dark colour scheme, corresponds to `326adf8` or earlier) and the local `main` checkout, which moved during this session from `326adf8` to `dca9f52` (four UI-redesign commits, 01:12–02:00 BST, not deployed). Checked against the nine pages under `developer.chrome.com/docs/ai/webmcp`, the GoogleChromeLabs `webmcp-tools` demos repository, the Devpost Resources tab, and the OpenAI developer showcase.
**Runtime:** Google Chrome 152.0.7977.65 launched with `--enable-features=WebMCP`, Node 22.20.0, Playwright 1.62.1. No ChatGPT in-app-browser run was possible from this session.

## Executive summary

**Verdict: the native WebMCP path works on the live build in real Chrome; conformance with the Chrome docs is high; the judges' primary client (ChatGPT in-app browser) remains unverified on the current build.**

| Check | Result |
|---|---|
| CLI `bin/action-check.mjs run` against the live URL and the production Worker | PASS, exit 0. Broken lane 2 effects, protected lane 1 |
| Native tool discovery on the live page | 3 tools registered on `document.modelContext`, `executeTool` input mode `json-text` |
| Off-script agent probes (36 calls across 4 sessions) | Every call returned `ok:false` with `code`, `message`, `nextAction`, or succeeded correctly. No silent state corruption |
| Chrome docs conformance | Pass on API surface, lifecycle, annotations, permissions, origin isolation, and character budgets for names and descriptions. Two Low findings, one gap |
| ChatGPT in-app browser (judges' primary client) | **Not run.** Last verified on the 1 September build; `src/` changed on 2 September |

Findings that change agent behaviour:

1. **Low — state-unaware recovery hint (loop risk).** `issue_refund` before approval returns `HUMAN_APPROVAL_REQUIRED` with `nextAction: "Stage the comparison and use the visible approval control."` in both the not-staged and the staged-awaiting-approval states. An agent that follows the hint literally after staging will call `stage_refund_comparison` again, which resets the trial and drops the pending approval, and the cycle repeats. Also, `stage_refund_comparison` after approval is accepted silently and discards the approval (probe S2c). Fix: make the hint state-aware and tell the agent to wait for the person's approval when a trial is already staged.
2. **Low — schema errors do not name the failing field.** Missing, extra, mistyped, or mis-cased arguments all return the same `INPUT_MISMATCH` text ("did not match the strict staging tool schema"). Chrome's best-practice page asks for descriptive errors so the model can self-correct. Fix: include the first Zod issues (path and reason) in the message.
3. **Gap — no probabilistic (LLM-driven) eval exists.** All 171 automated checks are deterministic. Chrome's evals guidance and `webmcp-evals` expect at least one model-driven journey. This session had no API key or local model, so the gap stands. The ChatGPT in-app run is the only model-driven evidence available before the deadline.

## 1. What was run

### 1.1 CLI against the live site

```sh
node bin/action-check.mjs run --url https://action-check-webmcp.vercel.app \
  --tool issue_refund --observe examples/observe-refund-staging.mjs \
  --target-base-url https://action-check-refund-staging-target-production.ancient-dust-0cb4.workers.dev
```

Result: `verdict: PASS`, exit code 0, Chrome 152, four tool calls, two independent `/v1/observe` reads (effect counts 2 and 1), page proof `proof_ready`. The README command is correct as written.

### 1.2 Live page in Chrome with and without the flag

| State | First viewport |
|---|---|
| Chrome 152 + WebMCP flag | "Native WebMCP ready", "READY · 3 registered tools", Step 1 of 4 instruction with copy button, simulated-agent CTA below |
| Chrome 152 without flag | "NATIVE WEBMCP · UNAVAILABLE IN THIS BROWSER", "0 registered tools", red "SETUP NEEDED · BLOCKED" row, "AGENT PROMPT UNAVAILABLE", simulated-agent CTA below |

Console: one `Failed to load resource: 404` on the first load in both modes; it did not reproduce in a second run with request logging, so it is a transient asset fetch rather than an app error. No page errors.

The no-flag state is honest but reads as broken at a glance. This is the most likely source of a "doesn't work" impression if the page was opened in ordinary Chrome or Safari. The handover already lists softening this row as an optional polish item.

### 1.3 Off-script probes

Script: `probe.mjs` (session scratchpad; reuses the `executeTool` pattern from `bin/action-check.mjs`). Yardstick: Chrome's "Fail gracefully and enable recovery" section of the build-tools page.

| Session / step | Call | Result | Assessment |
|---|---|---|---|
| S1a | `prove_refund_comparison` before staging | `PROOF_NOT_READY`, next: call issue_refund twice per lane | Good |
| S1b | `issue_refund` before staging | `HUMAN_APPROVAL_REQUIRED`, next: stage and use the approval control | Good for this state |
| S1c | `stage_refund_comparison` | ok; returns trialRef, paymentId, amountMinor, currency, requestId, deploymentId | Good: agent gets exact values without math |
| S1d | `stage_refund_comparison` again before approval | ok; new epoch, page still asks for approval | Acceptable; consumes a reset |
| S1e | `issue_refund` after staging, before approval | `HUMAN_APPROVAL_REQUIRED`, **same hint as S1b** | Finding 1 |
| S1f, S1g | wrong `requestId`, wrong `amountMinor` after approval | `INPUT_MISMATCH`, next: use the exact approved arguments | Good |
| S1h–S1k | missing `currency`, extra property, `amountMinor` as string, `lane: "Broken"` | `INPUT_MISMATCH`, generic schema text | Finding 2 |
| S1l | broken ×2, protected ×2 with exact values | `PROVIDER_ACK_LOST_AFTER_COMMIT` then ok, per lane; page strip advances retry → deliver → prove | Good |
| S1m | third `issue_refund` on broken | `CALL_LIMIT_REACHED`, next: prove or stage a fresh trial | Good |
| S1n | `prove_refund_comparison` | ok, `proof_ready`, 2 vs 1, effect IDs, digests; page "Unsafe created 2 refunds. Protected created 1." | Good |
| S1o | prove again | ok, same proof | Good (idempotent) |
| S1p | `issue_refund` after proof | `CALL_LIMIT_REACHED` | Good |
| S1q | stage after proof | ok, new trial awaiting approval | Good |
| S2c | **stage again mid-flight after approval and one delivery** | ok; trial reset, approval dropped | Finding 1 (silent) |
| S2d | `issue_refund` after the mid-flight re-stage | `HUMAN_APPROVAL_REQUIRED` with the "stage" hint | Finding 1 (loop) |
| S3c, S3e | prove after 1 and after 2 of 4 calls | `PROOF_NOT_READY` with the right next step | Good |
| S4b | `executeTool` with non-JSON text | Chrome throws "Failed to parse input arguments" before the tool runs | Browser behaviour, fine |
| S4c | `stage_refund_comparison` with an extra property | `INPUT_MISMATCH` | Good (strict) |

### 1.4 Character budgets (Chrome secure-tools page)

| Item | Budget | Measured |
|---|---:|---|
| Tool names | 30 | 12, 23, 23 |
| Tool descriptions | 500 | 172 (issue), 228 (prove), 171 (stage) |
| Parameter names | 30 | 4–11 |
| Parameter descriptions | 150 | 50–60 |
| Tool output | 1,500 | stage ≈330, issue ≈250, **prove 1,726** |

The proof output exceeds the recommended output budget because the `receipt` Markdown repeats the structured fields. Low priority; the page renders the receipt from session state, so the tool output could omit it if desired. Not changed today.

### 1.5 Headers relevant to WebMCP

- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()` does not touch the `tools` feature, so the default (`self`) applies and top-level registration works. Verified by the 3 registered tools.
- No `Origin-Agent-Cluster: ?0` header, so origin isolation is intact as the overview page requires.
- `frame-ancestors 'none'` and `X-Frame-Options: DENY` mean no cross-origin embedding, so `exposedTo` and `allow="tools"` are correctly unused.

## 2. Conformance checklist against the Chrome docs

Pages read in full: overview, imperative-api, declarative-api, best-practices, secure-tools, build-tools, evals, use-cases, compare-mcp.

| Doc | Requirement or recommendation | Action Check | Status |
|---|---|---|---|
| Overview | Chrome 149+ with `chrome://flags/#enable-webmcp-testing`, or origin trial | Detects `document.modelContext`; no origin-trial token (judges use the flag or ChatGPT) | Pass; token optional |
| Overview | Origin-isolated document; `tools` permissions policy | See 1.5 | Pass |
| Overview | Test with the Model Context Tool Inspector extension | Not used in this session (browser extension disconnected) | Founder can run |
| Imperative | `document.modelContext.registerTool({name, description, inputSchema, execute})` | `src/adapters/webmcp/browser-model-context.ts` binds exactly this | Pass |
| Imperative | Unregister via `AbortSignal` | Registration lifecycle uses one `AbortController`; disposed with the page | Pass |
| Imperative | `execute(input, {signal})` forwards cancellation | `executionSignal(options)` forwarded to session calls | Pass |
| Imperative | `getTools()` / `executeTool()` with JSON string input | Native test and CLI probe object then JSON text; Chrome 152 needs JSON text | Pass |
| Imperative | `annotations.readOnlyHint` / `untrustedContentHint` | All three `false`; every tool mutates trial state and returns Action Check's own synthetic data | Pass |
| Imperative | `exposedTo`, `fromOrigins`, `toolchange` | Not needed (no cross-origin frames) | N/A |
| Declarative | Form-based tools | Not used; the human approval control is deliberately a page button, not a tool | Pass by design |
| Best practices | One function per tool, no overlap | stage / issue / prove | Pass |
| Best practices | Static registration by default; dynamic when state-dependent | Three static tools; optional canary registers only after readiness | Pass |
| Best practices | Verb names that distinguish initiation from execution | `stage_` initiates, `issue_` executes, `prove_` verifies | Pass |
| Best practices | Positive descriptions, trust the agent | Descriptions are positive; on-page prompt in later phases uses "Do not call … again" | Minor; human-pasted text |
| Best practices | Minimise cognitive load: raw values, enums, typed params | `stage` returns the exact values to reuse; `lane` is an enum; `amountMinor` typed integer | Pass |
| Best practices | Validate strictly in code, loosely in schema; descriptive errors | Schema is strict (`additionalProperties:false`, patterns) and code errors are generic for schema failures | Finding 2 |
| Best practices | Graceful rate limits; UI updates after tool completion | Worker returns `429 RESET_RATE_LIMITED` (20 per 10 s); page strip advances after each call (verified) | Pass |
| Best practices / Evals | Evaluation-driven testing with a model | Deterministic only (150 unit, 20 e2e, 1 native, 11 Worker) | Gap |
| Secure tools | Hints, `exposedTo` discipline, character budgets | See 1.4 and 1.5 | Pass except proof output size |
| Build tools | Define user goal, initial state, role-play, variance, fail gracefully, evaluate | Goal and state explicit on the page; role-play encoded in the four-step strip; every error carries `nextAction` | Pass with Finding 1 |
| Compare MCP | WebMCP for the in-page action, backend for durable state | Registered tools in page; Cloudflare Worker as the outcome plane | Consistent |
| Use cases | Narrative guidance | N/A | N/A |

## 3. Devpost Resources tab check

| Item on the Resources tab | Action Check |
|---|---|
| Test in ChatGPT's in-app browser or Chrome with the flag | Chrome flag: verified today. ChatGPT: verified on the 1 September build only |
| Working, publicly hosted project | Live, HTTP 200, Worker reachable |
| Description explaining the WebMCP implementation | `devpost-description.md` v7.x answers the four organiser questions |
| Public repo with open-source licence | Public snapshot repo, MIT |
| Video under 3 minutes with audio | Rendered MP4 exists locally; YouTube URL not yet on Devpost |
| Free testing access through 21 September 17:00 PT | Vercel and Worker must stay deployed and funded; nothing in the repo tracks this |
| No edits after the deadline | Freeze plan already in the handover |
| Chrome resources: `useWebMCPTool`, Angular support, `webmcp-evals`, DevTools guide, demos repo | Hand-rolled adapter instead of the hook (allowed; forum staff said the snippet is not required verbatim); `webmcp-evals` not used |
| OpenAI showcase (`developers.openai.com/showcase`, "WebMCP apps" tab) | Tab says "WebMCP examples are coming soon"; submissions go through `openai.com/form/showcase-submission`; entries carry title, one-line summary, "Try it live" link, description, build notes, and built-with tags. Post-23-September action only |

## 4. Comparison with the Chrome demos repository

The `webmcp-tools/demos` README pattern is: one live link, one sentence, one example prompt per demo. Action Check's README has the live link and sentence but no single example prompt line. The on-page "Copy agent instruction" text is the equivalent; adding it to the README as an "Example prompt" line would match the demos' convention. The demos also ship `shared/webmcp-polyfill.js` for unsupported browsers; Action Check uses an honestly labelled in-page simulated agent instead, which is a valid alternative.

## 5. Recommended actions

Before Submit, in order:

1. **Founder: run the ChatGPT in-app-browser journey on the current build** (procedure in section 6). This is the only remaining unverified judge path.
2. **Optional, small, on a branch:** Finding 1 (state-aware `HUMAN_APPROVAL_REQUIRED` hint) and Finding 2 (name the failing field). Both are message-only changes in `src/refund-comparison/implementation/create-session.ts` and `src/adapters/webmcp/register-refund-comparison-tools.ts`. Deploying them requires the snapshot push and Vercel redeploy with the usual founder confirmation.
3. **Optional polish:** soften the red "SETUP NEEDED · BLOCKED" row shown in non-WebMCP browsers so the simulated-agent path reads as the intended fallback rather than a failure.
4. **After 23 September:** submit to the OpenAI showcase; add an "Example prompt" line to the README; run `webmcp-evals browser` with a model key to close the eval gap.

## 6. ChatGPT in-app browser procedure (founder)

1. Use the ChatGPT desktop app on a personal Free or Plus account. Enterprise and Edu accounts do not expose WebMCP. Settings → enable "site Tools".
2. Open `https://action-check-webmcp.vercel.app/` in the in-app browser. Confirm the hero shows "Native WebMCP ready" and "READY · 3 registered tools".
3. Press "Copy agent instruction", paste it into the chat, send. Expected: the agent calls `stage_refund_comparison`; the page changes to "Staging reset passed — approve the $42 request".
4. Press "Approve exact staging refund" on the page. Return to the chat and send "Approved, continue".
5. Expected: four `issue_refund` calls (broken twice, protected twice) then `prove_refund_comparison`. Page shows "Unsafe created 2 refunds. Protected created 1." with no `SIMULATED` labels in the trace.
6. If it fails, capture: which tool the agent called, the `code` in the TOOL RESPONSE panel, and whether the agent called `stage_refund_comparison` a second time after approval (the loop in Finding 1).

## 7. Local `main` (UI redesign `dca9f52`) browser verification

The four redesign commits (light colour scheme, one-step-per-screen layout, first viewport shows the current step only) touch `RefundProofHero.tsx`, `WorkbenchPage.tsx`, `styles.css`, and `index.html` only. The tool adapter, session, Worker, and tests are unchanged. Run at 12:03 BST against the local preview of that build (`http://127.0.0.1:4173`, Worker dev on `:8787`):

| Suite | Result |
|---|---|
| `vitest run` (unit + DOM) | 23 files, 150 tests passed |
| `playwright test` (desktop + Pixel 7) | 20 passed |
| `playwright test --config playwright.native.config.ts` (Chrome 152, WebMCP flag) | 1 passed |

The accessible names the CLI and native journey depend on ("Approve exact staging refund", "Approved", the `data-next-action` strip) survived the redesign. The live site still serves the earlier dark build; deploying the redesign remains a founder decision and needs the usual snapshot push and Vercel redeploy.

## 8. Fix branch for Findings 1 and 2

Branch `fix/agent-recovery-messages` in worktree `.worktrees/agent-recovery`, based on `dca9f52`. Message-only changes, no behaviour change:

- `src/refund-comparison/implementation/create-session.ts`: `HUMAN_APPROVAL_REQUIRED` now distinguishes "no trial yet" (hint: call `stage_refund_comparison`) from "staged, awaiting the person" (hint: wait for the approval press, retry the same call; re-staging discards the pending approval).
- `src/adapters/webmcp/register-refund-comparison-tools.ts`: `INPUT_MISMATCH` for schema failures now lists up to four offending fields with the Zod reason, bounded to 500 characters.
- Tests added: two in `tests/refund-comparison.test.ts`, one in `tests/refund-comparison-webmcp.test.ts`. Written first and confirmed failing on the old messages, then passing after the change. Full unit suite: 153 passed.
- Gates on the branch: `tsc -b` exit 0; `vitest run` 153/153. `check:public` throws `EISDIR` inside the worktree because of its `node_modules` symlink (it passes in the main checkout, 148 files scanned, including this audit); run the gates from `main` after merging. If merged, the description's "150 unit" count becomes 153.
- The branch touches none of the redesign's files, so it also cherry-picks cleanly onto `326adf8` if the older build is the one that ships.

## 9. Release on the founder's go (12:15–12:25 BST)

The founder chose the light interface. Actions taken, in order:

1. Fast-forwarded `main` to include the fix branch (`a52980f`).
2. Reviewed the four redesign commits: removed the unused `compact` lane prop and always-false `promptCollapsed` flag plus their orphaned CSS; softened the no-WebMCP guide row from red "SETUP NEEDED · BLOCKED" to amber "Native path · Not in this browser" naming the simulated agent as the fallback; added an inline SVG favicon so the live page has zero console errors (`aadf015`).
3. Local gates on that tree: vitest 153/153, `tsc -b`, `check:public` (main checkout), Worker check, Vite build, e2e 20/20, native 1/1, CLI PASS against a preview on `:5173` with the local Worker.
4. Deployed with `npx vercel --prod --yes` (deployment `usm8jkt5f`, live 12:19 BST). Worker unchanged.
5. Live re-verification against the stable URL: e2e 20/20, native 1/1, CLI PASS (2 vs 1), zero console errors, favicon 200.
6. Release captures recorded from the deployed build at 1280×720 and written to `docs/screenshots/` (three replaced, one added for the fallback state).

Still owed by the founder on this exact build: the ChatGPT in-app-browser journey (section 6), the public video, the Devpost description and gallery refresh, and Submit.

## 10. Evidence retained

- CLI proof JSON and stderr, probe log (36 entries), and page screenshots with and without the flag are in the session scratchpad; the tables above reproduce the parts that matter.
- Fetched doc copies: nine Chrome pages as `.md.txt`, the demos README, `AWESOME_WEBMCP.md`, `webmcp-evals` README, the showcase page and one entry page.
