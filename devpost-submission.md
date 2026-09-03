# Devpost description (mirror)

This file mirrors the project description entered on Devpost for the WebMCP Challenge. The Devpost page is the canonical copy; this mirror exists so the repository and the submission text stay in step.

---

Why this use case is a strong fit for WebMCP

WebMCP lets an agent call a site's tools directly. The moment those tools are consequential — refunds, cancellations, payouts — the tool's response becomes the weakest link: it can say "success" while the external system did nothing, or did it twice. Action Check registers a real issue_refund WebMCP tool and a prove_refund_comparison tool, and treats every response as a claim to be checked against a separately served ledger. Payment providers document idempotency keys for exactly this reason: a retried charge or refund must not land twice. Once an agent is the one retrying, that guarantee needs a test from outside, not a promise from the tool.

How it creates a better experience

A person reviews the exact payment, amount, currency and request ID and approves those values in the page. The agent then drives the same synthetic refund twice against a broken target and a protected target. The harness deliberately drops the provider acknowledgement on the first call, so the agent retries with the same request ID.

Broken target: 2 calls → 2 provider effects
Protected target: 2 calls → 1 provider effect

Action Check reads both ledgers through /v1/observe, not through the tool response, and renders the proof with UUID effect IDs and an evidence digest.

What people and agents can now do together

A human sets the boundary once (approve these exact values); the agent does the repetitive, error-prone execution and retry; the page independently proves the outcome to both. Before WebMCP, that verification lived in a separate test harness nobody ran. Now it is a page any agent can be pointed at, with a zero-effect baseline (/v1/reset) and cleanup (/v1/cleanup) per trial. For visitors without a WebMCP-capable browser, an honestly-labelled simulated agent runs the same four steps in-page and reaches the same proof — every trace row says so.

How WebMCP was implemented

Tools are registered with document.modelContext (src/adapters/webmcp/register-refund-comparison-tools.ts), with JSON-schema inputs and descriptions written for the agent as the customer. Approval stays outside the registered tool surface. Every tool is registered through the AbortSignal lifecycle for clean unregistration and carries readOnlyHint/untrustedContentHint annotations; one further tool, run_external_target_canary, registers only after a same-origin readiness check passes, so it does not exist on the page until it is safe to call. The staging target is a Cloudflare Worker backed by per-run SQLite Durable Objects: /v1/invoke returns only an action claim; /v1/observe returns durable effect state. Tests: 153 unit across 23 files, 20 end-to-end, 1 native-Chrome WebMCP, 11 Worker, plus 36 off-script agent-recovery probes (wrong order, wrong arguments, re-staging mid-flight, third call) that all returned a structured error with a next step — all green on 3 September; the end-to-end, native-Chrome, probe and command-line runs were made against the public URL.

Run the check from outside the page

The repository also ships bin/action-check, a version-zero command-line check added on 2 September. It launches real Chrome with the WebMCP flag, discovers the page's tools, performs the approval click, calls issue_refund twice per lane with one request ID, and then asks a caller-supplied observe() what the ledger actually holds. Its verdict comes only from that independent read, and it fails if observe() merely echoes the tool's claims — that negative control is unit-tested. Run against the live URL it printed PASS: two effects on the broken lane, one on the protected. v0 supports this refund fixture only; pointing it at another team's tool needs an adapter, which is the next piece of work.

How it differs from a reference implementation of a safe action

Some entries build the guarantee into their own tool: a one-time approval consumed atomically before the provider call, plus a signed receipt (Witnessed Refund is a well-made example). Action Check is the test that tells you whether your tool has that property. It does not need the tool's internals instrumented: it drives the action from outside, reads the resulting state from a ledger the tool does not control, and reports the gap between what the tool claimed and what happened. The same harness runs against a broken target and a protected one in one trial, which is why it can show two effects versus one. Proof from outside is the product; the refund fixture is only the first target.

Testing instructions

Open the live URL in ChatGPT's in-app browser on a personal Free or Plus account (Settings → Enable site Tools) or Chrome 149+ with chrome://flags/#enable-webmcp-testing enabled and Chrome relaunched. No login. Step 1: send the on-page instruction; the agent calls stage_refund_comparison. Step 2: approve the exact values shown. Step 3: the agent calls issue_refund twice per lane. Step 4: the agent calls prove_refund_comparison; the proof panel shows 2 effects vs 1. Without a WebMCP browser, press "Run with a simulated agent" for the same steps, labelled as simulated.

With Chrome 149+ installed, the same check runs headlessly from a clone of the repository: node bin/action-check.mjs run --url https://action-check-webmcp.vercel.app --tool issue_refund --observe examples/observe-refund-staging.mjs --target-base-url https://action-check-refund-staging-target-production.ancient-dust-0cb4.workers.dev — exit code 0 means the 2-versus-1 outcome was independently observed.

Verified on the live URL: Chrome 152 with WebMCP enabled (native journey, browser journeys and the command-line check, 3 September) and ChatGPT's in-app browser (1 September build).

Synthetic only. No payment provider is connected and no money moves. The refund staging target is Action Check-owned infrastructure for this fixture; other action types need their own staging adapters.
