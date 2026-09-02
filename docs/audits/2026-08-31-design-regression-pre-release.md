# Action Check design regression — independent pre-release check

Date: 2026-08-31
Baseline: saved Fable `design-baseline.json` (review workspace outside this repository)
Fable review mode: audit-only
Remediation follow-up: Codex applied and verified the single P1 fix after the independent review
Independent checker: Anthropic Fable, read-only and limited to the participant-approved baseline, current screenshots, and named public UI source files

## Verdict

**GO FOR LOCAL RELEASE FREEZE — overall design B+ (baseline B).**

The redesign is materially stronger and resolves 13 of the 20 baseline findings. Fable found one P1 issue: the **Approve exact synthetic refund** control overflowed and clipped at 1280×900, then shifted the completed proof capture horizontally. The affected row now stacks through the 1400px desktop band, the CTA can wrap, and a real-browser geometry assertion covers the exact 1280×900 failure. No P0 issue was found.

The local design blocker is cleared. Do not restyle the product or add features before release; freeze this interface and validate the deployed URL in the exact judging client.

## Grade delta

| Category | Baseline | Current | Assessment |
|---|---:|---:|---|
| Hierarchy | B | B | Strong hero; the second numbered four-step rail remains. |
| Typography | B− | B− | Strong display voice; micro-type and h1/h2 competition remain. |
| Spacing | B | B | Generally disciplined; the constrained approval band now stacks before clipping. |
| Color | B− | B | Previous AA failure resolved. |
| Interaction | C+ | B | Copy feedback, live verdicts, touch targets, and state-aware CTAs improved. |
| Responsive | B− | B | Mobile/tablet fixes are strong; the judge-path CTA regression is remediated and covered at 1280px. |
| Content | B+ | A− | WebMCP surface and synthetic boundaries are explicit and honest. |
| Motion | A− | A− | Stable, restrained; live stage transitions still hard-flip. |
| AI-slop | A | A | No AI-slop patterns observed. |
| Performance | A− | A− | Carried from local evidence; no production performance run in this audit. |

## Current flow results

The independent review captures are stored under `/private/tmp/action-check-design-regression-20260831/`. Remediation captures are stored under `/private/tmp/action-check-approval-fix-20260831/`.

| Step | Evidence | Result |
|---:|---|---|
| 1 | `01a-desktop-fold-1280x900.png` | **Pass.** Hero owns the fold; native status and agent tools are immediately visible. |
| 2 | `02a-mobile-fold-375x667.png`, `02c-mobile-hero-375x667.png`, `02d-mobile-copy-confirmation.png` | **Pass.** Mobile ordering, wrapping, 44px controls, Copy → Copied feedback, and status announcements work. |
| 3 | `03b-negative-control-running.png`, `03c-negative-control-fail.png` | **Pass.** The broken control fails honestly, identifies the removed protection, and offers recovery actions. |
| 4 | `04a-safe-running.png`, `04b-safe-pass.png` | **Pass.** The protected path finishes with one provider effect and a visible PASS verdict. |
| 5 | `01-approval-1280.jpg` | **Pass after remediation.** At 1280×900 the CTA ends at 1211.99px, remains inside the 1231px approval boundary, and the root and region have no horizontal overflow. |
| 6 | `02-proof-1280.jpg` | **Pass after remediation.** Page-defined WebMCP completes 2 calls → 2 effects versus 2 calls → 1 effect with a 1280px root width and no horizontal displacement. |
| 7 | `06-tablet-fold-768x900.png` | **Pass.** The tool strip, status, prompt, and 2×2 stage rail remain legible. |
| 8 | `03-approval-375.jpg`, `04-proof-375.jpg` | **Pass after remediation.** At 375×667 the approval CTA and final proof remain inside their 305px content regions with no root overflow. |

## Baseline finding regression matrix

| ID | Status | Current evidence |
|---|---|---|
| FINDING-001 | Resolved | Native status wraps; unavailable state includes a ChatGPT/Chrome pathway hint in source and tests. |
| FINDING-002 | Resolved | Prompt has a 44px Copy control with success/failure feedback. |
| FINDING-003 | Open | Hero and supporting suite still expose separate numbered four-step rails. |
| FINDING-004 | Partially resolved | Supporting cases are labeled UI-only fixtures, but case 02 still shares the `issue_refund` name. |
| FINDING-005 | Resolved | Mobile stage text wraps without ellipsis. |
| FINDING-006 | Resolved | Team-facing footnote replaced by a judge-facing fixture disclosure. |
| FINDING-007 | Resolved | Relevant controls and disclosures use the shared 44px touch target. |
| FINDING-008 | Open | Live stage transitions still change state without meaningful motion. |
| FINDING-009 | Open | The page h1 still competes with the larger hero h2. |
| FINDING-010 | Resolved | The failing `#586778` use is gone; summary text now uses the muted token. |
| FINDING-011 | Resolved | Hero and shell share their main breakpoints; the approval row now adds a content-specific 1400px stack to protect the judge path. |
| FINDING-012 | Open | Read-only evidence remains visually over-carded. |
| FINDING-013 | Resolved | Decorative AC mark is hidden from assistive technology. |
| FINDING-014 | Resolved | Obsolete registration rules and empty mobile transport value are removed. |
| FINDING-015 | Resolved | Social canary states use namespaced classes; the running-indicator collision is gone. |
| FINDING-016 | Open | Raised-surface token remains unused and ad-hoc panel backgrounds remain. |
| FINDING-017 | Resolved | Suite state symbols use named image roles; stage text has accessible equivalents. |
| FINDING-018 | Resolved | PASS/FAIL and hero phase changes are announced through live status regions. |
| FINDING-019 | Open | 8.8px micro-type and an inconsistent type scale remain; the source-only checker counted 66 sub-12px declarations. |
| FINDING-020 | Resolved | Required Barlow, IBM Plex Mono, and Source Sans weights are loaded in `main.tsx`. |

## Remediated P1 finding

The approval panel uses:

- `grid-template-columns: minmax(230px, 0.62fr) minmax(390px, 1fr) auto`;
- a 24px gap;
- a button with `white-space: nowrap`;
- a stacking rule that starts only at `max-width: 1120px`.

At 1280×900, the main content width could not satisfy those minimums, so the CTA left the viewport. The new Playwright assertion failed before remediation with the button ending at **1289.36px** against a maximum of **1281px**.

The fix extends the two-column approval layout and full-width CTA through `max-width: 1400px`, and permits the CTA text to wrap. The same regression then passed, including button-to-region containment and root/region overflow checks. Fresh in-app-browser evidence measured the fixed button at **370–1211.99px** inside the **349–1231px** approval region.

## Strengths

- The product thesis is visible in the layout: registered agent surface → exact human approval → mutating target → response-independent proof.
- The negative control proves the test is sensitive rather than merely producing green output.
- Synthetic limits and UI-only supporting fixtures are stated plainly.
- Mobile is intentionally reordered rather than mechanically stacked.
- Native WebMCP registration, invocation, and the final ledger comparison were exercised in the current in-app browser run.
- The 1280px regression was demonstrated failing before the CSS change and passing after it.

## Remaining non-blocking debt

- Consolidate the two four-step rails after release.
- Reduce sub-12px type and establish a real type scale.
- Replace ad-hoc panel backgrounds with surface tokens.
- Reduce full-card treatment for read-only evidence.
- Add non-color cues to failed trace steps and consider restrained stage-transition motion.

## Evidence limits

- The unavailable-browser hint, External Target disconnected state, and native registering/failed states were not visually exercised in this run.
- The audit and remediation used the local build, not the eventual public deployment or frozen release commit.
- Fable did not perform a second post-fix review; the remediation evidence comes from Playwright, native Chrome, and the in-app Browser run.
- Full-page in-app-browser captures duplicated fixed/sticky content, so the review used clean viewport captures instead.
- A judge-client run against the public URL remains required.

## Release action

Freeze the release, create the public repository, deploy the static build to HTTPS, then repeat discovery, approval, target invocation, and proof against the live URL in the exact judging client. Capture final submission screenshots from that deployed run.
