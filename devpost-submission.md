# Devpost description (mirror)

This file mirrors the project description entered on Devpost for the WebMCP Challenge. The Devpost page is the canonical copy; this mirror exists so the repository and the submission text stay in step.

---

Why this use case is a strong fit for WebMCP

WebMCP lets a site expose typed tools that an agent calls directly. The moment a tool is consequential — a refund, a booking, a return, a publish — the tool's reply becomes the weakest link: it can say "done" while the system did nothing, or did it twice. Action Check is a test harness for those tools. It calls a site's registered WebMCP tool exactly as an agent would, through document.modelContext.executeTool in real Chrome, treats the reply as a claim, and passes only after a second read of state from somewhere the reply cannot forge. Chrome's own WebMCP evals guidance asks developers to verify the side effect and to test mid-chain failure. Without WebMCP you would script clicks and test a UI; with it you test the tool the agent will actually call.

How it creates a better experience

The main demo answers one question a payments team would ask before exposing a refund tool: can one retry accidentally refund twice? A person approves the exact payment, amount, currency and request ID in the page. The agent then drives the same refund twice against a broken target and a protected target. Action Check deliberately drops the provider acknowledgement on the first call, so the agent retries with the same request ID, exactly as a real agent would after a lost reply.

Broken target: 2 calls → 2 provider effects
Protected target: 2 calls → 1 provider effect

The verdict comes from reading both ledgers through a separate observation endpoint, never from the tool reply, and is bound to UUID effect IDs and an evidence digest.

What people and agents can now do together

The person sets the boundary once (approve these exact values); the agent does the repetitive, error-prone execution and retry; Action Check independently proves the outcome to both. Before WebMCP that verification lived in a test harness nobody ran. Now it is a page any agent can be pointed at, and a command any developer can run against their own tool. For a visitor without a WebMCP browser, an honestly labelled simulated agent runs the same four steps in-page; every trace row says so.

How WebMCP was implemented

Three tools are registered with document.modelContext (src/adapters/webmcp/register-refund-comparison-tools.ts): stage_refund_comparison, issue_refund, prove_refund_comparison, with JSON-schema inputs and descriptions written for the agent as the customer. Approval stays outside the tool surface: the approve button is a page control an agent cannot press. Every tool is registered through the AbortSignal lifecycle and carries readOnlyHint/untrustedContentHint annotations. Every error carries a code, a message and a nextAction, and the hints are state-aware, so an agent that calls a tool at the wrong moment is told what to do next rather than left to guess; 36 off-script calls (wrong order, wrong arguments, re-staging mid-flight, a third delivery) all fail closed. The staging target is a Cloudflare Worker backed by per-run SQLite Durable Objects: /v1/invoke returns only an action claim, /v1/observe returns durable effect state. Tests: 166 unit across 24 files, 20 end-to-end, 1 native-Chrome WebMCP journey, 11 Worker, all green on 3 September; the end-to-end, native-Chrome, probe and command-line runs were made against the public URL.

Run the check from outside, on any page

bin/action-check is a command-line check that launches real Chrome with the WebMCP flag, discovers a page's tools, and cross-checks a tool's claims against a caller-supplied observe() that reads the site's own state. Against the built-in refund fixture it performs the approval click, calls issue_refund twice per lane, and prints PASS only when the independent ledger shows two effects on the broken lane and one on the protected. Its external-target mode (added 3 September) points the same check at any page's registered tool: --input gives the arguments, --mode retry calls twice with identical input, --mode once calls once, and the verdict comes only from observe() before and after. Run on 3 September against three of Google's public WebMCP demos, pages we do not own, in Chrome 152. Sports storefront: add_search_result_to_cart retried twice put two lines in the site's own cart (FAIL DUPLICATE_EFFECT, so an agent retrying after a lost reply double-adds). Smart Home: rearrangeDOMComponents with an unknown component id replied "Dashboard successfully updated with requested components" while the dashboard rendered nothing (FAIL FALSE_SUCCESS); with two real ids the cards appeared (PASS, positive control). zaMaker: add_topping retried duplicated (FAIL), remove_topping on an empty pizza refused honestly (PASS), set_pizza_size twice was idempotent (PASS). Proof JSON for every run is in the repository. Declarative form tools that navigate on submit are reported as unsupported rather than checked; that is the next step.

How it differs from an agent checking itself, and from a reference implementation

An agent asking "did that work?" reads the same reply it should distrust. Action Check injects the fault so the retry path actually executes, repeats the same trial as code, and fails if observe() merely echoes the reply, a unit-tested negative control. Some entries build the guarantee into their own tool: a one-time approval consumed atomically before the provider call, plus a signed receipt (Witnessed Refund is a well-made example). Action Check is the test that tells you whether your tool has that property, from outside, without instrumenting its internals.

What it is not

Action Check owns no ledger and connects to no payment provider. Its verdict is exactly as strong as the observe() read it is given: a provider API, the site's own records, or what the page shows a person afterwards. In the main demo that read is Action Check's own Worker, so the independence is architectural (a separate endpoint the tool cannot write into), not organisational. Every payment, effect and request ID is synthetic. No money moves.

Testing instructions

Open the live URL in ChatGPT's in-app browser on a personal Free or Plus account (Settings → Enable site Tools) or in Chrome 149+ with chrome://flags/#enable-webmcp-testing enabled and Chrome relaunched. No login. Step 1: press "Copy agent instruction" and send it; the agent calls stage_refund_comparison. Step 2: press "Approve exact staging refund". Step 3: tell the agent to continue; it calls issue_refund twice per lane. Step 4: the agent calls prove_refund_comparison; the page shows 2 effects versus 1. Without a WebMCP browser, press "Run with a simulated agent" for the same steps, labelled as simulated.

With Chrome 149+ installed, from a clone of the repository: node bin/action-check.mjs run --url https://action-check-webmcp.vercel.app --tool issue_refund --observe examples/observe-refund-staging.mjs --target-base-url https://action-check-refund-staging-target-production.ancient-dust-0cb4.workers.dev (exit 0 means 2 versus 1 was independently observed), and node bin/action-check.mjs run --url 'https://googlechromelabs.github.io/webmcp-tools/demos/smart-home/#/' --tool rearrangeDOMComponents --input '{"componentIds":["nonexistent_widget"]}' --observe examples/observe-smart-home-dashboard.mjs --mode once (exit 1: the false success is caught).

Verified on the live URL: Chrome 152 with WebMCP enabled (native journey, browser journeys, agent-recovery probes and both command-line checks, 3 September) and ChatGPT's in-app browser (1 September build).
