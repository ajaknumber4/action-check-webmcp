# Design-audit remediation

Date: 2026-08-31

Scope: the saved Action Check design review's ranked items 1–10, checked against the newer current worktree before any change. The industrial visual direction was intentionally preserved.

## Result

Seven live findings were fixed, two findings were already resolved by newer work, and one visible bug report was stale but exposed dead CSS that was removed. Two adjacent low-cost accessibility/responsive findings were also fixed.

| Rank | Finding | Current result | Evidence |
|---|---|---|---|
| 1 | F14 leftover registration rules | **Stale visible bug; cleanup complete.** No component still renders the former header registration classes and Technical Details has no empty native-status row. The dead selectors and mobile hide rules were deleted. Native state remains always visible in the hero. | DOM regression asserts the obsolete Technical Details row is absent; full desktop/mobile journeys pass. |
| 2 | F15 canary class collision | **Fixed.** Panel states use `canary-panel-*`; the running dots use `canary-running-indicator`. Ready and running panel treatment is explicit. | DOM regression requires the running panel class and rejects the collided class. |
| 3 | F1 native status truncation and pathway | **Fixed.** The label wraps instead of ellipsizing and the unavailable chip says `Open in Chrome 149+ (WebMCP flag) or ChatGPT’s browser`. | Unavailable-state DOM assertion plus 375 px computed-style regression. |
| 4 | F2 prompt copy action | **Fixed.** The ready prompt has a 44 px **Copy prompt** control with **Copied** and bounded failure states; the instruction remains selectable. | DOM test proves the exact state-aware prompt is passed to the Clipboard API; live local click reached **Copied**. |
| 5 | F10 contrast bypass | **Fixed.** The technical-summary helper now uses `--text-muted` instead of `#586778`. | Source check and browser regression. |
| 6 | F-live verdict announcement | **Fixed for the live gap.** Supporting PASS/FAIL verdicts are concise atomic status regions, including explicit negative-control sensitivity context. The hero already moved focus and used a single polite proof announcement, so no duplicate live region was added there. | DOM assertions cover safe PASS and deliberately broken FAIL announcements. |
| 7 | F17 suite state semantics | **Fixed.** Each suite state glyph is an image role with a text name; the parent button also retains the state in its accessible name. | DOM and browser accessibility-tree assertions. |
| 8 | F7 touch targets | **Fixed.** Canary, secondary, download, top-level mobile, copy, and disclosure controls now meet the shared 44 px target. | 375×667 browser regression measures the judge-reachable controls. |
| 9 | F6 External Target footnote | **Already resolved; current disclosure retained.** The team-facing sentence is absent. The rail now truthfully says the supporting cases are UI-only fixtures, not registered agent tools. | DOM regression rejects the obsolete sentence and requires the truthful disclosure. |
| 10 | F11 parallel breakpoint scale | **Fixed.** Hero reflows now use the existing 1120/820/560 scale. The 560 px rule preserves the Agent-tools-first small-screen order. | Desktop/mobile journeys and the 375×667 first-viewport gate pass. |

Additional adjacent fixes:

- F5: mobile stage details wrap instead of ellipsizing.
- F13: the decorative `AC` mark is hidden from the accessibility tree.

Deferred system debt remains intentionally outside the pre-submission patch: panel-background retokenization, full type/spacing scales, broader hierarchy redesign, and decorative motion.

## Verification

- `npm run ci:check`: passed; 19 test files / 123 tests and production build.
- `npm run test:e2e`: passed; 16 desktop/mobile journeys, embedded Axe scans, keyboard flow, 375×667 fold gate, label wrapping, and touch-target checks.
- `npm run test:native-webmcp`: passed; one installed-Chrome native discovery/invocation journey.
- Live local visual review: desktop and 375×667 mobile; no observed horizontal clipping, the Agent tools strip remains in the first mobile viewport, and the copy control reaches **Copied**.

The saved-baseline design-review regression is still an independent checker step, not claimed complete here.
