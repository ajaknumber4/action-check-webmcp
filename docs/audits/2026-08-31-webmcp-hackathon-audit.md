# WebMCP Challenge audit — Action Check

> **Superseded snapshot.** This audit describes the pre-refund-hero build with six internal workbench-control tools. It is retained as decision history only. See `2026-08-31-hackathon-audit-reconciliation.md` for the finding-by-finding current status. Current implementation and release evidence live in `README.md`, `docs/DESIGN_SPEC.md`, and `docs/QA_EVIDENCE.md`; none of the tool counts, demo steps, screenshots, or open code actions below should be used in the submission.

Date: 2026-08-31. Deadline: **2026-09-03 13:00 PDT** (rules page; ignore the 5pm figure some blogs quote). Research base: 60 items across GitHub/HN/Reddit/X/YouTube (raw: `~/Documents/Last30Days/webmcp-raw-v3.md`), hackathon rules + resources pages, live UI capture, and repo verification runs.

## Verdict

**Keep this use case. Do not pivot.** The concept is validated by the 30-day evidence: trust/safety of WebMCP tools is the loudest developer theme in the window, and nobody in the ecosystem is testing tool *effects* — only tool *availability*. The risks are (1) three hard submission requirements are currently unmet, and (2) the entry is dev-infra in a challenge whose brief and reference demos lean consumer-collaborative. Both are fixable by positioning and shipping, not rebuilding.

## Does this use case match what people actually want from WebMCP?

What the last-30-days window shows:

- **The ecosystem's sales pitch is "agents can finish the job."** Cloudflare's one-switch WebMCP preview (2,850 likes, their top post), Sodium ("turns all your website's features into WebMCP tools", 1,269 likes), Greg Isenberg's 88K-view "Let AI agents pay you money" video. Adoption tooling is crowded — being *another* way to register tools would be a losing entry.
- **Trust and verification is the open gap.** Chrome ships an official secure-tools guide (malicious manifests, contaminated outputs); an arXiv paper this month covers WebMCP tool-surface poisoning (squatting, unregister/re-register exploits); prompt injection is OWASP #1 for LLM apps. On the Aug 26 HN thread (57pts/59cmt), the recurring skeptic arguments are "why trust this" and "two copies of logic drift."
- **Direct validation of Action Check's exact positioning**, from a top comment on the Isenberg video (@ArrowMem): *"WebMCP and Cloudflare's Agent Readiness Score both answer 'can an agent use this site' but nothing checks what happens to the data it hands over once it does."* Nothing in the window occupies "test what the tool actually did."
- **Accessibility is the other resonant frame** (simonw on HN: "an incredible accessibility technology disguised as an AI thing") — worth one line in the description, not a repositioning.
- Coverage caveat: Reddit returned partial results (HTTP 403 on the auth path), so absence of Reddit signal is not evidence of absence.

Conclusion: an effect-test runner for mutating WebMCP tools sits on the highest-energy open problem in the WebMCP conversation. The use case works.

## Hard submission requirements vs. current state

| Requirement | Status | Action |
|---|---|---|
| Public repo (GitHub/GitLab/Bitbucket) | **MISSING — no remote, and the entire Action Check pivot is uncommitted** (4 commits total; ~32 modified + `server/`, `docs/`, fixtures untracked) | Commit the pivot, create public GitHub repo, push `main`, today |
| Open-source license visible in repo | LICENSE exists (MIT per README) | Verify file present at root after push |
| Live hosted URL, working in ChatGPT browser / Chrome 149+ (flag) | **MISSING — no deployment** | Static Vite build deploys standalone (canary is blocked-by-default and needs no server). Netlify/Vercel/Cloudflare starters + credits are in the resources list |
| <3 min YouTube demo video, clear audio | **MISSING** | See demo script below |
| Description explaining WebMCP fit + UX improvement | Drafts exist (README/SCOPE) | Condense for the Devpost form |
| Judging-client verification | **NOT RUN** — SCOPE.md itself names this a release gate | After deploy: ChatGPT desktop browser + Chrome 149+ `chrome://flags/#enable-webmcp-testing`; confirm an agent discovers and invokes all six tools against the live URL |
| In-window build provenance | Good — HACKATHON_PROVENANCE.md documents Aug 29–30 start, all in-window | Fill the submission-freeze row at tag time |

Verified locally today: `ci:check` passes (typecheck, unit, build, exit 0) and `test:native-webmcp` passes against installed Chrome launched with `--enable-features=WebMCP` ("exposes the native API and accepts all registrations"). What local tests cannot prove: discovery/invocation in the actual judging clients — that is the top remaining verification task.

### Compatibility risk: single API surface

The adapter binds **`document.modelContext.registerTool` exclusively** (`src/adapters/webmcp/browser-model-context.ts:72,105,109-114`). There is no `navigator.modelContext` fallback, no `provideContext` support, and no runtime polyfill. That matches the spec text cited in `docs/audits/2026-08-31-webmcp-readme-alignment.md` and passes against local flag-enabled Chrome — but the ChatGPT in-app browser's surface is unverified (`docs/hackathon/CANONICAL_HANDOFF.md` lists that gate as unperformed). When unavailable it fails closed to a label *inside the collapsed Technical details*, so a judge would see a working page and never know registration failed. **De-risk with ~10 lines: feature-detect `document.modelContext` → `navigator.modelContext`, accepting `registerTool` on either.** Registration is also refused in iframes and insecure contexts (`NOT_TOP_LEVEL` / `INSECURE_CONTEXT`) — deploy on HTTPS at a top-level URL.

## Judging-criteria fit

1. **WebMCP Leverage** — Strong on mechanics: six imperative tools with strict schemas, cancellation forwarding, bounded outputs, fail-closed optional seventh tool. One structural weakness the repo's own alignment audit already flags: the four mutating "tools under test" (`confirm_booking`, `issue_refund`, `deploy_service`, `publish_post`) are **fixture labels, not registered WebMCP tools** — no mutating WebMCP tool is actually invoked and independently checked end-to-end. **Highest-value remaining code change:** register those four synthetic actions as real WebMCP tools too, so an agent literally calls `issue_refund` over WebMCP and Action Check proves the effect. That upgrades the story from "agent drives a test harness" to "agent calls a mutating WebMCP tool and the harness catches the injected fault," and it makes the demo self-evidently non-trivial. Also make the tool surface *visible* (see UI notes).
2. **Execution** — Strong if deployed: deterministic one-click suite, PASS/FAIL from replayed state, negative control ("Run broken version" proves the test can catch the bug). Tests green.
3. **Potential Impact** — Credible but must be argued in the description: every team shipping consequential WebMCP actions needs effect tests; cite the trust-gap evidence above.
4. **Creativity & Ambition** — Differentiated: nothing in the showcase window tests effects. The closest neighbours are human-in-the-loop review tools, which approve a proposed change rather than verify a completed one.

**Fit risk to manage:** the brief says "apps people and their agents can use together" and all five reference demos (3D modeling, collaborative writing, crossword, itinerary, Duckboard) are consumer-collaborative. Action Check's answer is its caller-separation design — *the agent runs diagnostics and replay; only the human can approve the fix*. Lead the description and video with that human+agent loop, not with "test harness."

### Demo video (highest-leverage remaining artifact)

One take, <3 min, agent-driven end to end:
1. Agent (ChatGPT browser or Chrome+Gemini) is asked: "check whether issue_refund is safe to ship."
2. Agent calls `read_case` → `run_diagnostics` → `replay_flow` on the broken version → visible FAIL + "Sensitivity check: Passed."
3. Human clicks the single approval; agent re-runs safe version → PASS. Narrate: "the human approved, the agent verified."
4. Close on the four-case suite going green + one line on why a success response alone can never pass.

## UI review

The current redesign (captured live today) is a large improvement over the `docs/screenshots/` images and is genuinely strong: clear left test-suite rail, one headline question ("Will this tool do the right thing?"), 4-stage rail, EffectContract panel, fault card with primary/secondary actions, honest NOT RUN → PASS result panel with event trace and bounded metrics. Mobile layout works (horizontal case scroller). Keep it; do not restyle before the deadline.

Three targeted improvements, in priority order:

1. **Make the WebMCP surface judge-legible.** The judged thing is the tool surface, and the UI currently tucks it into a small registration label and a collapsed "Technical details." Add a compact, always-visible "Agent tools" strip (six tool names + registration state dot), and flash the corresponding tool name when an agent invocation arrives. A judge in the ChatGPT browser should *see* the site reacting to their agent.
2. **Make the blocked Social strip read as intentional or hide it.** "Real check not connected" on a judged build risks reading as "unfinished." Either label it "Optional staging integration (disabled in this demo)" with no dead affordance, or omit the strip entirely in the deployed build.
3. **Refresh or delete stale screenshots before the repo goes public.** `docs/screenshots/action-assurance-*.jpg` show the abandoned dense design and will be the first images a judge meets in the tree; replace with captures of the current UI (desktop + mobile + PASS state).

Minor polish (only if time remains): the lime-on-black accent system is distinctive — ensure focus states and the RUNNING state use it consistently; verify the four-stage rail advances visibly during a run (stages 1–2 highlighted pre-run in today's capture).

## Open question for the entrant


## Ranked action plan (72h)

1. Commit the pivot and push to public GitHub (license at root) — today.
2. Deploy static build (Netlify/Vercel/Cloudflare) — today; the app runs standalone (no separate server; the canary broker degrades to not-configured).
3. Add the dual-surface feature detection (`document` → `navigator` modelContext) before the judging-client check.
4. Run the judging-client gate against the live URL (ChatGPT desktop browser + Chrome 149+ `chrome://flags/#enable-webmcp-testing`); fix anything discovery-related immediately.
5. If time allows (it should — roughly half a day): register the four mutating actions as WebMCP tools (see criteria fit #1).
6. UI change #1 (agent-tools strip) and #2 (social strip labeling); refresh screenshots.
7. Record and upload the demo video.
8. Devpost form (entry currently "Untitled", submission not-started per `.devpost-hackathon-state.json`): description leading with human+agent loop + trust-gap evidence; submit ≥12h before the Sep 3 13:00 PDT cutoff; fill the provenance freeze row.

## Evidence appendix

- Raw research: `~/Documents/Last30Days/webmcp-raw-v3.md` (engine run 2026-08-31, 60 items, Reddit partial/403)
- Hackathon: webmcp.devpost.com (rules, resources), openai.com/webmcp-challenge
- Chrome docs: developer.chrome.com/docs/ai/webmcp (+ secure-tools, evals, DevTools pages)
- HN threads: 49450417 (57pts/59cmt), 47211249 (360pts early-preview), 49455713 (challenge)
- Local verification: `npm run ci:check` exit 0; `npm run test:native-webmcp` 1/1 passed (2026-08-31)
