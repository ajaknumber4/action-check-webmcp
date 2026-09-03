# Action Check: UI pass and "does it work for real" audit

**Date:** 2026-09-03, 13:27–13:50 BST. **Target:** https://action-check-webmcp.vercel.app/ (local `main` `6c68653`, public repo tip `c566f65`, pushed 13:25 BST). **Method:** installed Google Chrome 152.0.7977.65 driven by Playwright, with and without `--enable-features=WebMCP`; three CLI runs; source read for the two page components and the CLI. The Claude-in-Chrome extension was not connected, so nothing was driven interactively.

**Evidence:** `~/.gstack/projects/WebMCP/designs/design-audit-20260903/` (24 screenshots across idle, awaiting-approval, proof, negative-control and mobile states; text and design-system extracts per viewport; the three CLI proof JSONs and logs).

---

## 1. Does it actually work? Yes, and here is what was run today

| Run | Result |
|---|---|
| CLI, built-in fixture against the live URL and production Worker | exit 0, PASS. Broken lane 2 calls → 2 effects, protected 2 calls → 1 effect, read from `/v1/observe`. Real Chrome 152, native `executeTool`, JSON-text input mode. 4.8 s |
| CLI external-target, Google Smart Home demo, `rearrangeDOMComponents` with an unknown id | exit 1, FAIL `FALSE_SUCCESS`. Reply said "Dashboard successfully updated"; rendered cards went 1 → 0 |
| CLI external-target, Google Sports storefront, `add_search_result_to_cart` twice | exit 1, FAIL `DUPLICATE_EFFECT`. Cart lines 0 → 2 |
| Native page journey in Chrome 152 (tool calls through `document.modelContext`) | prove-before-stage → `PROOF_NOT_READY`; issue-before-approval → `HUMAN_APPROVAL_REQUIRED`; full flow → proof; third call after proof → `CALL_LIMIT_REACHED`. Every error carried `code`, `message`, `nextAction`. 0 console errors |
| Simulated agent in plain Chrome (no WebMCP) | approval button in 0.85 s, proof in 2.8 s, lower-suite PASS and "Broken behavior caught" both reached. 0 console errors |
| Console, all six viewport/flag combinations | 0 errors, 0 warnings |

So the tool is not a mock. The CLI launches the user's own Chrome, discovers the page's registered tools, calls them the way an agent does, and takes the verdict from an independent read.

## 2. Why it looks like "just a synthetic run", and how it actually works

There are two products sharing one name, and the page only shows the first.

**The web page** is a self-contained demonstration. It registers three WebMCP tools on itself, and the "payment provider" is Action Check's own Cloudflare Worker with a known-bad lane and a protected lane. An agent calls the tools, a person presses Approve, and the Worker's separate `/v1/observe` route is read for the verdict. The page cannot be pointed at any other system. The lower "4 UI examples" are in-memory fixtures that run entirely in the browser: no network, no WebMCP, page buttons only. The page says so, but they take roughly 60% of the scroll height.

**The CLI** is the capability the Devpost description sells ("a command any developer can run against their own tool"):

```sh
node bin/action-check.mjs run --url <any page> --tool <registered tool> \
  --input '{...}' --observe <your-observe-module.mjs> --mode retry|once
```

It launches Chrome 149+ with WebMCP, waits for the page to register the named tool, calls your `observe()` (which reads the page's DOM, localStorage or API, and never sees the tool reply), invokes the tool once or twice through `document.modelContext.executeTool`, calls `observe()` again, and computes the verdict from the delta. "Pointing it at a real system" means writing a 20-line `observe()` for that system; five examples exist in `examples/`. Limits that are real: a local Chrome 149+ is required; the tool must not navigate the document (the Bistro demo fails as a harness error); the retry verdict assumes one effect increments the count by one; the built-in fixture's fault injection and human approval do not exist in generic mode.

**The disconnect a judge will feel:** the page contains zero links (`links: []` in the extract). It never mentions the CLI, the repository, or the six recorded runs against Google's demos. A judge who reads the description, opens the URL and sees only the refund fixture will conclude what the founder concluded: it is a synthetic run. That is finding 1 below.

## 3. Design and UI findings

Classifier: APP UI (task-focused tool page, not a landing page). Trunk test: PARTIAL. Site and page are identifiable; there is no section navigation and the second half of the page reads as a continuation of the first rather than a different thing.

### High impact

**F1. The credible part of the product is not on the page.** No link to the repo, no CLI mention, no external-target results. Fix: a short third section, "Run it on any page", with the six recorded Google-demo results as a static table (dated, labelled as recorded runs, not live), the one-line command, and links to the repo and proof JSON. This answers Impact and Creativity on the page itself.

**F2. "External target" is a naming bug.** The tools strip says "External target · TARGET URL CONFIGURED" and the footer line says "External synthetic staging demo". Both mean "Action Check's own separate Worker" but read as "a third-party system is connected", which is exactly the misreading to avoid. Rename to "Staging ledger" or "Staging Worker".

**F3. Heading hierarchy is inverted.** The `<h1>` is the 12px mono kicker "TEST WHAT WEBMCP ACTIONS ACTUALLY CHANGE." The 57.6px title "Can one retry accidentally refund twice?" is an `<h2>`, and the next `<h2>` ("Test suite") is 12.8px. Screen-reader outline and visual outline disagree. Markup and CSS fix.

**F4. In the native-ready state the working button is de-emphasised.** With WebMCP on, "Copy agent instruction" is a 187×98 black block, the largest control on the page, while "Run with a simulated agent" is a thin outline. Devpost lists Chrome-with-flag as a judging surface; whether a flag-only judge has an agent to paste into cannot be verified from here. If they do not, the dominant CTA is a dead end and the button that works is the small one. Give the two equal weight in that state.

### Medium impact: the duplicated framing the founder noticed

These are the "overlapping text" items, all visible in the idle desktop screenshot:

1. The disclosure sentence appears twice within about 60px: the STG footer ("Staging sandbox only. No payment account is connected and no real money moves.") and the runner-intro line ("External synthetic staging demo · no payment account connected · no real money moves"). Keep one.
2. Native readiness is shown three times: the green "NATIVE WEBMCP / Native WebMCP ready" box, "READY / 3 registered tools" in the tools strip, and the kicker state. Keep one.
3. Four-step progress appears twice in the hero: the "01 You + agent → 02 You → 03 Agent → 04 Action Check" strip and "STEP 1 OF 4" in the Next strip. Keep the strip, drop the counter or vice versa.
4. A third 1–4 stepper ("Define contract / Inject fault / Run tool / Check state") opens the lower suite. It is a different four steps, which is confusing next to the first.
5. "Two tool calls create exactly one provider refund." appears as the Passing-behavior callout and again as "Pass when" inside the Injected-fault card.
6. The test-suite block has two header rows: the toolbar ("4 synthetic contracts · Run 4 UI examples") and the aside header ("TEST SUITE · Simulated examples").

Removing these cuts the idle page by roughly a third of its visible words without losing a fact.

### Medium impact: other

**F5. Mono labels dominate.** 146 elements render in IBM Plex Mono against 131 in the body face; 64 declarations use 0.75rem (12px), and 30 leaf text nodes are under 14px on desktop. The "lab report" look is deliberate and distinctive, but at this density the uppercase mono labels stop being labels and become the page. Raise the label floor to 13px and drop half the labels (many restate the value beside them, e.g. "TOOL CALLS 2").

**F6. Mobile source order.** At 390px, "Copy agent instruction" renders in the row above the instruction text it copies. Put the text first.

**F8. Flag-off copy contradicts itself.** Seen live in the founder's own Chrome profile (no WebMCP flag): the tools strip header says "AGENT TOOLS · Available on this page" and the status directly beneath says "UNAVAILABLE · 0 registered tools". Change the header to "Agent tools · registered by this page" or make it state-aware.

**F9. 1120–1400px layout.** At the 1204px width of a normal Chrome window the tools strip drops its status column below the tool chips and the "Available on this page" label wraps to four lines. The breakpoint at 1120px should move the status inline rather than stacking.

**F7. Lower suite chrome to content ratio.** For one button ("Run test") the page shows a stepper, a breadcrumb, an H2, a passing-behavior callout, a verification-rule card, an injected-fault card and a "NOT RUN" report card before anything happens. Collapse the rule and fault cards into one, and let the report card appear only after a run.

### Polish

- Grid/two-column layout, 44px touch targets, `focus-visible` rings, disabled states and `prefers-reduced-motion` are all present. No horizontal scroll at 390, 768 or 1440.
- Colour system is 10 colours, semantic, warm-neutral, defined as CSS variables. Light only, and `color-scheme: light` is declared, so that is consistent.
- No AI-slop patterns: no gradients, no icon-in-circle grids, no emoji, no centred-everything, real typefaces (Barlow Condensed, Source Sans 3, IBM Plex Mono).
- Proof state is the best screen on the site: two lane cards with red/green numbers, then the "Caught the unsafe duplicate. Protected stayed single." verdict. That screen should be the first gallery image and the video's climax.

### Nav question

No side or top menu. It is a one-page tool with two (after F1, three) sections. The problem is duplicated framing, not missing chrome. If F1 lands, a three-link jump row under the header ("Refund demo · Run it on any page · UI examples") is enough.

### Grades (design-review rubric)

| Category | Grade | Why |
|---|---|---|
| Visual hierarchy | C | F3, F4, three status indicators |
| Typography | B | mono density, 12px floor |
| Colour and contrast | A | coherent, semantic, variables |
| Spacing and layout | B | consistent grid; F7 |
| Interaction states | B | complete; F4 |
| Responsive | B | stacks sensibly; F6 |
| Motion | B | none, reduced-motion respected |
| Content and microcopy | C | six duplicates, F2 |
| AI slop | A | none |
| Performance feel | B | 0 console errors, fonts self-hosted; LCP not measured |

**Design score: B−. AI slop score: A.**

## 4. Adversarial judge view (Devpost rubric)

| Criterion | Grade | Evidence and gap |
|---|---|---|
| WebMCP leverage | A− | Three imperative tools with schemas, `readOnlyHint`/`untrustedContentHint`, AbortSignal lifecycle, state-aware `nextAction` on every error, CDP `WebMCP` domain and `executeTool` from outside in the CLI, external-target mode proven on pages the team does not own. Gap: the four lower cases do not touch WebMCP and occupy most of the page |
| Execution | B+ | Every state reached today with 0 console errors; fallback works without WebMCP. Gaps: ChatGPT in-app browser not verified on this build (it is the primary judging surface); flag-only judge risk (F4); latest rendered video (`renders/action-check-demo-v6b_2026-09-03_01-05.mp4`, written 2 Sep 23:54) predates the light UI deployed 3 Sep 12:19 |
| Potential impact | B | The problem is real and the Google-demo findings are the strongest proof point in the entry. Gap: that proof is only in the README |
| Creativity and ambition | A− | A test harness for other people's WebMCP tools is unlike the "add tools to my shop" entries. Gap: same as above; the page shows one fixture |

## 5. Ranked fixes

| # | Fix | Judge impact | Effort (Claude Code) | Touches |
|---|---|---|---|---|
| 1 | Add "Run it on any page" section: static six-run table, command, repo link | High | 60–90 min incl. e2e/Axe update | `WorkbenchPage.tsx`, `styles.css`, one e2e |
| 2 | Rename "External target" → "Staging ledger"; delete the duplicate disclosure line; collapse the three readiness indicators into one; drop one hero stepper and the suite's second header | High | 30–45 min | hero, page, styles; e2e aria-label assertions |
| 3 | Equal weight for "Copy agent instruction" and "Run with a simulated agent" in native-ready state | Medium | 10 min CSS | `styles.css` |
| 4 | Make the big title the `<h1>`; kicker becomes a span | Medium (a11y) | 15 min | `WorkbenchPage.tsx`, `RefundProofHero.tsx`, e2e `page-title` |
| 5 | Mobile: instruction text before the copy button | Low | 10 min CSS | `styles.css` |
| 6 | Label floor 13px; remove labels that restate their value | Low | 30 min | `styles.css`, hero |

Fixes 2–5 are about one hour together; fix 1 is the one that changes how the entry reads.

## 6. Founder-only items, in order

1. ChatGPT in-app browser journey on this build. Never verified after the 1 September build, and it is the first judging surface named on Devpost.
2. Video re-cut on the light UI (see Execution row), then YouTube Public, then the URL into Devpost.
3. Gallery: lead with the proof-state screenshot; delete the four dark images at positions 1–4.
4. Submit.

## 7. Applied (branch `feat/ui-audit-fixes`, 14:00 BST)

On the founder's go, fixes 1 to 5 plus F8 landed on a branch off `main`, verified against a fresh local build: 167 unit tests (one new), 20/20 e2e with Axe on desktop and Pixel 7, 1/1 native Chrome, public-boundary scan clean, 0 console errors at three viewports with and without the WebMCP flag.

- F1: "Run it on any page" section between the refund demo and the UI examples, with the six recorded runs, the command, and links to the repo and proof JSON. Header nav with three jump links and GitHub.
- F2: "Staging ledger" replaces "External target"; the duplicate disclosure line is gone.
- F3: hero title is the `<h1>`; hero subheadings are `<h2>` (Axe heading-order caught the skipped level on the first pass).
- F4, F5, F8 as specified. Third stepper, "Pass when" duplicate and the suite's second header row removed.
- F9 correction: the stacked tools strip seen in the founder's window is the 820px breakpoint under browser zoom, not a 1120px bug. No change.
- Not applied: F6 (label floor), F7 (lower-suite card collapse). Both are safe follow-ups.

Merged to `main` and deployed to production at 14:33 BST (Vercel deployment `h0la50yuw`). Re-verified on the live URL immediately after: 20/20 e2e with Axe, 1/1 native Chrome, CLI fixture PASS (2 effects against 1), 0 console errors at three viewports with and without the WebMCP flag.

## 8. Afternoon evidence run (14:00–14:20 BST)

A background agent ran the external-target CLI against the rest of Google's WebMCP demos in Chrome 152. Twelve runs completed; six were kept, six set aside.

Kept (now on the page and in the README): Ticket booking `select_showtime` with a real movie id on the movie page, FAIL `FALSE_SUCCESS` (the reply says "You can now proceed to checkout", the checkout section stays hidden); the same tool with an invalid id, PASS `HONEST_REFUSAL`; `update_location`, PASS `IDEMPOTENT`; Luxe Leather `add_to_cart` retried, FAIL `DUPLICATE_EFFECT` (cart page quantity 0 to 2, header badge still 1); Analytics dashboard `query` retried, PASS `IDEMPOTENT`; Explainer `cancelBooking` with an invalid id, PASS `HONEST_REFUSAL`.

Set aside (archived under `~/.gstack/projects/WebMCP/designs/design-audit-20260903/excluded-runs/`):

- Doors `hide`: the narrative reply "You can't see me" matched the refusal regex, so a real effect read as `SILENT_EFFECT`. Heuristic artifact.
- Doors `castLight` (once and retry): the tool aborts its own registration mid-call and Chrome rejects the call although the room lit up. Not a verdict the CLI can make.
- Explainer `bookSlot` retried: the banner count went 0 to 1 (PASS), but the two replies carry different confirmation ids, so the retry minted a second booking. A count cannot see identity. Not published as a PASS.
- Coffee shop `reorder_product` (retry and unknown id): the demo hard-codes its cart count to 1 and never validates the id, so both verdicts are true of the count and false of the cart.

One heuristic gap was clear-cut and is fixed on the branch: a reply shaped `{ "status": "error" }` was counted as a success claim, which turned Ticket booking's honest refusal into a `FALSE_SUCCESS`. `claimsSuccess` now treats `status: error | failed | failure` as a refusal, with two new unit tests; the probe was re-run and reads `HONEST_REFUSAL`. The `can't` regex match and the self-aborting tool are recorded here as limits, not changed.

## 9. What was not done

- No interactive browser session (extension disconnected); all browser evidence is headless Chrome via Playwright.
- No LCP/CLS measurement.
- No fixes applied. The checkout is shared with a live `.worktrees/ui` session and the entry is unsubmitted; changes wait for a go.
- The Devpost project gallery is not yet public, so no comparison against other entries was possible (6,493 registered participants).
