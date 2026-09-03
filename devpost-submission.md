# Devpost description (mirror)

This file mirrors the project description entered on Devpost for the WebMCP Challenge. The Devpost page is the canonical copy; this mirror exists so the repository and the submission text stay in step.

---

Why this use case is a strong fit for WebMCP

WebMCP lets a site hand an agent typed tools instead of a UI to scrape. Once one of those tools is a refund, a booking, a return or a publish, the reply is the only thing the agent sees, and a reply can say "done" when nothing happened, or when it happened twice. Action Check is a test harness for those tools. It calls a site's registered WebMCP tool the way an agent would, through document.modelContext.executeTool in real Chrome, treats the reply as a claim, and only passes after reading the resulting state from somewhere the reply cannot forge. Chrome's own WebMCP evals guidance tells developers to verify the side effect and to test what happens when a call fails mid-chain. Without WebMCP you would script clicks and be testing a UI. With it you test the tool the agent will call.

How it creates a better experience

The demo answers one question a payments team would ask before exposing a refund tool: can one retry refund twice? A person approves the exact payment, amount, currency and request ID in the page. The agent then issues the same refund twice against a known-bad target and a protected one. Action Check drops the provider acknowledgement on the first call on purpose, so the agent retries with the same request ID, which is what a real agent does after a lost reply.

Known-bad target: 2 calls, 2 provider effects
Protected target: 2 calls, 1 provider effect

The verdict comes from reading both ledgers through a separate observation endpoint, never from the tool reply, and it is bound to UUID effect IDs and an evidence digest.

What people and agents can now do together

The person sets the boundary once by approving exact values. The agent does the repetitive part: the calls and the retries. Action Check proves the outcome to both of them from a source neither controls. Before WebMCP that kind of verification lived in a test harness nobody ran. Now it is a page any agent can be pointed at, and a command any developer can run against their own tool. Visitors without a WebMCP browser can press "Run with a simulated agent" and watch the same four steps in the page; every trace row says it is simulated.

How WebMCP was implemented

Three tools are registered with document.modelContext in src/adapters/webmcp/register-refund-comparison-tools.ts: stage_refund_comparison, issue_refund and prove_refund_comparison, with JSON-schema inputs and descriptions written for the agent. Approval stays outside the tool surface: the approve button is a page control an agent cannot press. Tools register through the AbortSignal lifecycle and carry readOnlyHint and untrustedContentHint annotations. Every error returns a code, a message and a nextAction, and the hints depend on state, so an agent that calls a tool at the wrong moment is told what to do next. I ran 36 off-script calls against the live page (wrong order, wrong arguments, re-staging mid-flight, a third delivery) and all of them failed closed. The staging target is a Cloudflare Worker backed by per-run SQLite Durable Objects: /v1/invoke returns only a claim, /v1/observe returns the durable state. Tests: 166 unit across 24 files, 20 end-to-end, 1 native Chrome WebMCP journey, 11 Worker, all green on 3 September. The end-to-end, native Chrome, probe and command-line runs were made against the public URL.

Run the check from outside, on any page

bin/action-check launches real Chrome with the WebMCP flag, discovers a page's tools, and checks a tool's claims against an observe() function you supply, which reads the site's own state. Against the built-in refund fixture it performs the approval click, calls issue_refund twice per lane, and prints PASS only when the ledger shows two effects on the known-bad lane and one on the protected lane. The external-target mode, added on 3 September, points the same check at any page's registered tool: --input gives the arguments, --mode retry calls twice with identical input, --mode once calls once, and the verdict comes only from observe() before and after.

I ran it on 3 September against three of Google's public WebMCP demos, pages I do not own, in Chrome 152. Sports storefront: add_search_result_to_cart retried twice put two lines in the site's own cart (FAIL DUPLICATE_EFFECT; an agent retrying after a lost reply double-adds). Smart Home: rearrangeDOMComponents with an unknown component id replied "Dashboard successfully updated with requested components" while the dashboard rendered nothing (FAIL FALSE_SUCCESS); with two real ids the cards appeared (PASS, positive control). zaMaker: add_topping retried duplicated (FAIL), remove_topping on an empty pizza refused and changed nothing (PASS), set_pizza_size twice was idempotent (PASS). The proof JSON for every run is in the repository. Declarative form tools that navigate on submit are reported as unsupported rather than checked. That is the next step.

How it differs from an agent checking itself, and from a reference implementation

An agent asking "did that work?" reads the reply it should distrust. Action Check injects the fault so the retry path really runs, repeats the same trial as code, and fails if observe() just repeats the reply; that negative control is unit-tested. Some entries build the guarantee into their own tool, for example a one-time approval consumed before the provider call plus a signed receipt (Witnessed Refund is a good one). Action Check is the test that tells you whether your tool has that property, from outside, without touching its internals.

What it is not

Action Check owns no ledger and connects to no payment provider. A verdict is only as strong as the observe() read behind it: a provider API, the site's own records, or what the page shows a person afterwards. In the refund demo that read is Action Check's own Worker, so the independence is architectural (a separate endpoint the tool cannot write into) rather than organisational. Every payment, effect and request ID is synthetic. No money moves.

Testing instructions

Open the live URL in ChatGPT's in-app browser on a personal Free or Plus account (Settings, then Enable site Tools) or in Chrome 149+ with chrome://flags/#enable-webmcp-testing enabled and Chrome relaunched. No login. Step 1: press "Copy agent instruction" and send it; the agent calls stage_refund_comparison. Step 2: press "Approve exact staging refund". Step 3: tell the agent to continue; it calls issue_refund twice per lane. Step 4: the agent calls prove_refund_comparison and the page shows 2 effects against 1. Without a WebMCP browser, press "Run with a simulated agent" for the same steps, labelled as simulated.

With Chrome 149+ installed, from a clone of the repository: node bin/action-check.mjs run --url https://action-check-webmcp.vercel.app --tool issue_refund --observe examples/observe-refund-staging.mjs --target-base-url https://action-check-refund-staging-target-production.ancient-dust-0cb4.workers.dev (exit 0 means 2 against 1 was independently observed), and node bin/action-check.mjs run --url 'https://googlechromelabs.github.io/webmcp-tools/demos/smart-home/#/' --tool rearrangeDOMComponents --input '{"componentIds":["nonexistent_widget"]}' --observe examples/observe-smart-home-dashboard.mjs --mode once (exit 1: the false success is caught).

Verified on the live URL: Chrome 152 with WebMCP enabled (native journey, browser journeys, agent-recovery probes and both command-line checks, 3 September) and ChatGPT's in-app browser (1 September build).
