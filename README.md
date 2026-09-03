# Action Check

**Tests what a WebMCP tool actually did, from outside the tool.**

[Live demo](https://action-check-webmcp.vercel.app/) · [Devpost description](./devpost-submission.md) · MIT

A site can expose a refund, a booking or a publish action to agents through WebMCP. The tool's reply is the only thing the agent sees, and a reply can say "done" when nothing happened, or when it happened twice. Action Check calls the tool the way an agent would, treats the reply as a claim, and only passes after reading the resulting state from somewhere the reply cannot forge.

![Action Check live WebMCP discovery](./docs/screenshots/action-check-live-discovery.jpg)

## Judges start here — 60 seconds

**The one thing that is different:** every other way of testing an agent tool tests a page you built yourself. Action Check has been pointed at pages we do not own — seven of Google's own public WebMCP demos, twelve recorded runs — and five of those runs caught a real bug. The proof JSON for each is committed in [`docs/evidence/external-targets-2026-09-03/`](./docs/evidence/external-targets-2026-09-03/).

| Want to | Do this | Takes |
|---|---|---|
| See it work with no setup | Open the [live demo](https://action-check-webmcp.vercel.app/) and press **Run with a simulated agent**. No Chrome flag, no agent needed. The page labels every simulated step as simulated | 30s |
| See real WebMCP tool calls | Same page in Chrome 149+ with `chrome://flags/#enable-webmcp-testing`, driven by ChatGPT desktop or any WebMCP agent. Press **Copy agent instruction** | 2 min |
| See the bugs we found in Google's demos | The **Run it on any page** section, or [the table below](#any-pages-tool-external-target-mode) | 1 min |
| Point it at your own site | Same section: fill in a URL, tool name and JSON, and the page writes your `observe()` module and the command to run it | 5 min |

**What a PASS means:** a declared rule held for that one trial. Not that a business action succeeded, and not a security guarantee. Every payment, effect and request id in the demo is synthetic; no payment account is connected and no money moves.

## What it catches

- A retry that repeats an effect which already committed.
- A reply that claims success while the state did not change.
- An action that runs after the approved values changed.

## The demo: can one retry refund twice?

The page registers three WebMCP tools. An agent drives them; a person approves; Action Check reads a separate ledger.

| Step | Who | What happens |
|---|---|---|
| 1 | You + agent | You send the instruction. The agent calls `stage_refund_comparison`, which resets a fixed trial on the staging target |
| 2 | You | Check the payment, amount, currency and request ID, then press **Approve exact staging refund**. The button is a page control; an agent cannot press it |
| 3 | Agent | Calls `issue_refund` twice for the known-bad lane and twice for the protected lane, same request ID each time |
| 4 | Agent + Action Check | The agent calls `prove_refund_comparison`. Action Check reads both lanes through the observation endpoint and shows the result |

**Example prompt** (abridged; the page's **Copy agent instruction** button gives the full text with the approved values): "Call stage_refund_comparison with {}. Wait until I approve the exact trial shown on the page. Call issue_refund twice for lane \"broken\" using the approved payment, amount, currency and request ID; the first call is expected to return PROVIDER_ACK_LOST_AFTER_COMMIT, retry once with identical arguments. Do the same for lane \"protected\". Then call prove_refund_comparison with {}."

In each lane the first call commits the refund and the harness drops the provider's acknowledgement on purpose. The agent gets a bounded error and retries with the same request ID.

- **Known-bad target:** 2 calls, 2 refunds.
- **Protected target:** 2 calls, 1 refund.

The staging target is a Cloudflare Worker with one SQLite Durable Object per lane and run. `/v1/invoke` returns a claim and nothing else. `/v1/observe` returns the durable state: effect IDs and an evidence digest. Every trial starts with `/v1/reset`, which has to prove a zero-effect baseline, and ends with `/v1/cleanup`. It is Action Check's own fixture: no payment account is connected and no money moves.

In the native path the page has no button that stages, delivers or proves anything. Those steps only happen through the registered tools. The **Agent tools** strip shows the three names and their real registration state, and the **Next** strip says who acts now.

### Without a WebMCP browser

Press **Run with a simulated agent**. It runs the same four steps in the page, calling the same session functions the registered tools call, against the same Worker, and it stops at the same approval button. The page labels it clearly: a persistent badge, a `simulated` tag on every trace row, and a note on the proof that WebMCP discovery was not used. Source: `src/adapters/simulated-agent/run-simulated-refund-comparison.ts`.

## The three tools

| Tool | What it does |
|---|---|
| `stage_refund_comparison` | Resets both staging lanes, requires a zero-effect baseline, returns the values a person has to approve |
| `issue_refund` | Runs one approved attempt on one lane, then reads that lane back through the observation path |
| `prove_refund_comparison` | Takes fresh observations of both lanes, binds the proof to the effect IDs and digests, and renders known-bad against protected |

Inputs use strict schemas. Cancellation is forwarded. Registration is torn down with the page. Every error carries a code, a message and a `nextAction`, and the hints are state-aware, so an agent that calls a tool at the wrong moment is told what to do next. Calls fail closed when approval is missing, stale or does not match the input.

A fourth tool, `run_external_target_canary`, registers only after a same-origin readiness check passes. It is absent by default.

## Four more cases in the page

The lower section runs the same pattern on four synthetic tools, driven by page buttons rather than registered tools.

| Case | Tool | Injected fault | Pass condition |
|---|---|---|---|
| Booking changed after approval | `confirm_booking` | The quote changes after approval | No booking is created |
| Refund retried twice | `issue_refund` | The acknowledgement is dropped after commit | Two calls create one refund |
| Deploy said done, state unchanged | `deploy_service` | Success is reported while the service stays unhealthy | The false success is rejected |
| Post said live, stayed draft | `publish_post` | Success is reported while the post stays a draft | The false success is rejected |

**Prove this test catches the bug** removes the protection and shows the check failing. **Run safe version** puts it back.

## Run the check from outside

`bin/action-check.mjs` launches your installed Chrome 149+ with `--enable-features=WebMCP` (the Playwright-bundled Chromium has no native WebMCP), discovers the page's tools, and cross-checks a tool's claims against an `observe()` module you supply. Proof JSON goes to stdout, PASS or FAIL to the exit code.

Against the built-in fixture it performs the approval click itself and calls `issue_refund` twice per lane:

```sh
node bin/action-check.mjs run \
  --url https://action-check-webmcp.vercel.app \
  --tool issue_refund --observe examples/observe-refund-staging.mjs \
  --target-base-url https://action-check-refund-staging-target-production.ancient-dust-0cb4.workers.dev
```

Your `observe()` has to read a store the tool never writes into its own reply. If it just repeats the reply, the check fails; that negative control is unit-tested.

**You do not have to write either file from scratch.** The **Run it on any page** section of the [live demo](https://action-check-webmcp.vercel.app/#any-page) has a builder: type your target URL, the registered tool name, its JSON input and a mode, and it emits a starter `observe()` module and the exact command that uses it, both with a copy button. It runs nothing itself — a page can only see tools on its own `document.modelContext`, never another origin's, which is precisely why the check has to drive a real Chrome from outside.

### Any page's tool (external-target mode)

Add `--input '<json>'` and the CLI targets any registered WebMCP tool on any page. It reads the tool's description and schema through `document.modelContext.getTools()`, calls `observe()` before and after, invokes the tool once (`--mode once`) or twice with identical input (`--mode retry`, the default), and takes the verdict from those observations — in `once` mode, compared against whether the reply claimed success or refused. `observe(ctx)` gets the live Playwright `page`, so it can count DOM elements, call a read-only tool, or query the site's API. It never sees the tool's reply.

Runs recorded on 3 September against seven of Google's public [WebMCP demos](https://github.com/GoogleChromeLabs/webmcp-tools/tree/main/demos) in Chrome 152. Action Check does not own those pages. The proof JSON for each run is in `docs/evidence/external-targets-2026-09-03/`. Twelve runs, five caught a bug.

| Demo and tool | Mode | What `observe()` read | Verdict |
|---|---|---|---|
| Sports storefront `add_search_result_to_cart {"productId":"google-mls-pro-ball"}` | retry | the site's own cart in `localStorage.kinetic_cart`, 0 to 2 lines | **FAIL `DUPLICATE_EFFECT`**. A retried add-to-cart doubles the line |
| Smart Home `rearrangeDOMComponents {"componentIds":["nonexistent_widget"]}` | once | rendered dashboard cards, 1 to 0 | **FAIL `FALSE_SUCCESS`**. The reply says "Dashboard successfully updated with requested components"; the dashboard shows nothing |
| Smart Home `rearrangeDOMComponents` with two real ids | once | rendered dashboard cards, 1 to 2 | PASS `EFFECT_CONFIRMED` (positive control) |
| zaMaker `add_topping {"topping":"🍍","count":1}` | retry | rendered 🍍 toppings, 0 to 2 | **FAIL `DUPLICATE_EFFECT`** |
| zaMaker `remove_topping {"topping":"🍍"}` on an empty pizza | once | toppings, 0 to 0 | PASS `HONEST_REFUSAL`. The reply says "Topping 🍍 not found" and nothing changed |
| zaMaker `set_pizza_size {"size":"Large"}` | retry | the rendered size label | PASS `IDEMPOTENT` |
| Ticket booking `select_showtime` with a real movie id, on the movie page | once | the checkout section shown on the page, stays hidden | **FAIL `FALSE_SUCCESS`**. The reply says "You can now proceed to checkout"; the page re-renders and hides the checkout again. A person clicking the same showtime does not hit this path |
| Ticket booking `select_showtime {"movie_id":"nope",…}` | once | the checkout section, 0 to 0 | PASS `HONEST_REFUSAL`. The reply is `{"status":"error"}` and nothing changed |
| Ticket booking `update_location {"city":"Paris"}` | retry | the rendered location label | PASS `IDEMPOTENT` |
| Luxe Leather `add_to_cart {"variations":[{"color":"Brown","quantity":1}]}` | retry | line quantities on the site's own cart page, 0 to 2 | **FAIL `DUPLICATE_EFFECT`**. The header badge still says 1; the cart page says 2 and the subtotal doubled |
| Analytics dashboard `query` (count by status, horizontal bars) | retry | the three chart controls on the page | PASS `IDEMPOTENT` |
| Explainer `cancelBooking {"confirmationId":"BK-NOPE00"}` | once | the confirmed-booking banner, 0 to 0 | PASS `HONEST_REFUSAL` |

Six more runs from the same afternoon were recorded and then set aside because the verdict could not be trusted: three where the demo's reply or its self-aborting tool confused the claim heuristic, and three where a count-based `observe()` could not see the failure that mattered (a retry that minted a second confirmation id under the same banner, a cart count hard-coded to 1). They are listed in the 3 September audit, not on the page. Lesson: a verdict is only as good as what `observe()` reads.

```sh
node bin/action-check.mjs run \
  --url 'https://googlechromelabs.github.io/webmcp-tools/demos/smart-home/#/' \
  --tool rearrangeDOMComponents --input '{"componentIds":["nonexistent_widget"]}' \
  --observe examples/observe-smart-home-dashboard.mjs --mode once
```

Verdict codes: `IDEMPOTENT`, `DUPLICATE_EFFECT`, `NO_EFFECT` in retry mode; `EFFECT_CONFIRMED`, `FALSE_SUCCESS`, `SILENT_EFFECT`, `HONEST_REFUSAL` in once mode. Known limit: a declarative form tool that navigates on submit (the Le Petit Bistro demo, for example) replaces the document mid-call. The CLI reports that as a harness error instead of a verdict. Supporting it is the next piece of work. The refund fixture keeps its own path because it also injects the lost acknowledgement and waits for a human approval, which the generic mode does not do.

## Why WebMCP

WebMCP is the surface under test. The CLI and the page call tools through `document.modelContext.executeTool`, which is the call an agent makes. Without WebMCP you script clicks and test a UI, not the tool. Chrome's own WebMCP evals guidance asks developers to verify the side effect and to test mid-chain failure; that is what these checks do.

Some entries build the guarantee into their own tool, for example a one-time approval consumed before the provider call plus a signed receipt (Witnessed Refund is a good one). Action Check is the test that tells you whether your tool has that property. It drives the action from outside, reads the resulting state from a source the tool does not control, and reports the gap.

WebMCP itself does not give you authorization, idempotency, durable execution or truthful postconditions. Those belong to the application. Action Check makes them visible and testable.

## Architecture

- `src/refund-comparison`: the fixed trial, approval binding, two lanes, proof.
- `src/adapters/webmcp/register-refund-comparison-tools.ts`: the three registered tools.
- `src/integrations/external-effect-staging`: the browser-side `reset`, `invoke`, `observe`, `cleanup` adapter.
- `workers/refund-staging-target`: the staging Worker. One leased SQLite Durable Object per lane, exactly two invocations per run, rate-limited resets. Its invoke reply cannot supply proof.
- `src/app/RefundProofHero.tsx`: native status, the approval checkpoint, lane state, the result.
- `src/workbench/fixtures` and `src/workbench/scenarios`: the four supporting cases.
- `bin/action-check.mjs`, `bin/lib/run-generic.mjs`, `bin/lib/generic-verdict.mjs`: the CLI and its verdicts.
- `src/integrations/external-target-staging` and `server/external-target-staging`: an optional staging canary for a connected site, disabled by default. See [the canary contract](./docs/integrations/EXTERNAL_TARGET_STAGING_CANARY.md).

## Run locally

Node.js 22.x.

```sh
npm ci
npm --prefix workers/refund-staging-target ci
npm --prefix workers/refund-staging-target run dev
```

In a second terminal:

```sh
npm run dev
```

Open the URL Vite prints. On loopback the page talks to the Worker at `http://127.0.0.1:8787`. For a production build set `VITE_REFUND_STAGING_TARGET_URL` to the deployed Worker origin and allow the frontend origin in the Worker. `wrangler.jsonc` has separate local and production environments; run `npm run deploy:dry-run:production` before `npm run deploy:production` in the Worker package.

## Verify

```sh
npm run ci:check
npm run check:staging-target
npm run test:e2e
npm run test:native-webmcp
```

Results are in [docs/QA_EVIDENCE.md](./docs/QA_EVIDENCE.md). On the 3 September build the live URL passed 20 of 20 desktop and mobile browser journeys, the native Chrome 152 WebMCP journey, the CLI check (2 effects against 1), and 36 off-script agent-recovery probes, with no console errors. The ChatGPT in-app browser journey passed on the 1 September build.

## What this is and is not

- Every payment, booking, service, post, identity, request and effect is fictional or generated for the staging sandbox.
- The refund demo proves one synthetic idempotency comparison, not a general exactly-once guarantee.
- The staging ledger is separate from the browser session and durable for the trial. It is Action Check's own Worker, not a payment provider's record. The independence is architectural: a separate endpoint the tool cannot write into.
- A verdict is only as strong as the `observe()` read behind it: a provider API, the site's own records, or what the page shows a person afterwards.
- The four supporting cases are product hypotheses, not customer incidents.
- The staging target is public, with 15-minute leases. Do not put real data in it.
- A pass means the declared rule held for that trial. It does not mean a real business action succeeded.

See [PUBLIC_PRIVATE_BOUNDARY.md](./PUBLIC_PRIVATE_BOUNDARY.md) and [SECURITY.md](./SECURITY.md).

## Project documents

- [MVP and non-goals](./SCOPE.md)
- [Hackathon provenance](./HACKATHON_PROVENANCE.md)
- [Design specification](./docs/DESIGN_SPEC.md)
- [Refund staging target](./workers/refund-staging-target/README.md)
- [External Target staging canary contract](./docs/integrations/EXTERNAL_TARGET_STAGING_CANARY.md)
- [Boundary-check usage](./docs/PUBLIC_BOUNDARY_CHECK.md)
- [Third-party notices](./THIRD_PARTY_NOTICES.md)
- [Chrome docs conformance and agent probes](./docs/audits/2026-09-03-chrome-docs-conformance-and-agent-probes.md)

## Licence

MIT. See [LICENSE](./LICENSE).
