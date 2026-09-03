# Hackathon provenance

## Competition window

The WebMCP Challenge submission period opened on **2026-08-25 at 11:00 Pacific Time** and closes on **2026-09-03 at 13:00 Pacific Time**, according to the [official challenge rules](https://webmcp.devpost.com/rules).

## Project timeline

| Evidence | Timestamp | Status |
|---|---:|---|
| Independent concept and implementation planning began | 2026-08-29 | Complete |
| Local repository initialized | 2026-08-29T23:32:59Z | Complete; no remote is configured |
| First implementation commit | 2026-08-30T01:43:56+01:00 | `4cbe2f2e1b13ba8bb54cbbf1fea20e6acdca3865` (private working history; the public repository holds snapshot commits and does not contain this SHA) |
| Cross-industry effect-test pivot | 2026-08-30 | Four supporting synthetic cases implemented locally |
| Native refund-comparison hero | 2026-08-31 | Three-tool WebMCP target, visible approval, and 2-versus-1 proof implemented locally |
| External refund staging target | 2026-08-31 | Durable synthetic Worker, browser adapter, local end-to-end proof, and generated UUID effect evidence implemented and verified locally |
| Headless retry-proof CLI (v0) | 2026-09-02 | `bin/action-check` drives real Chrome with the WebMCP flag against a target page, performs the approval click, invokes `issue_refund` twice per lane, and cross-checks a separately supplied `observe()`; verified locally and against the public deployment |
| Light lab-report interface, agent-recovery message fixes, favicon | 2026-09-03 | Deployed to the stable URL at 12:19 BST and verified live: 20/20 browser journeys, 1/1 native Chrome 152 WebMCP journey, CLI PASS, 36 off-script probes fail-closed, zero console errors |
| External-target mode for the CLI (v0.1) | 2026-09-03 | `--input` targets any page's registered WebMCP tool; verdict from a caller-supplied observe() only; run against Google's Sports storefront, Smart Home and zaMaker demos in Chrome 152 (retry duplicates and a false success caught; honest refusal, idempotent set and a positive control confirmed); proof JSON kept in `docs/evidence/` |
| Public repository | 2026-09-01 | `github.com/ajaknumber4/action-check-webmcp`, published as snapshot commits (first snapshot `c0dc36e`); the private working history is not pushed |
| Public HTTPS deployment | 2026-09-01 | Live at https://action-check-webmcp.vercel.app/ (Vercel); synthetic refund-staging Worker deployed alongside — see README |
| Public demo video | Pending | No video URL exists |
| Devpost submission | Pending | The registered project remains a draft |
| Submission freeze | Pending | Record the exact submitted tag and timestamp |

All recorded implementation work falls after the submission period opened. Pending entries are intentionally not estimated.

## Work created during the challenge

- A serialized refund-comparison session backed by separate leased SQLite Durable Object lane records
- Three Action Check-owned default WebMCP fixture tools:
  - `stage_refund_comparison`
  - `issue_refund`
  - `prove_refund_comparison`
- Exact human approval bound to the current trial, epoch, payment, amount, currency, request ID, and digest
- A negative-control lane where two deliveries create two effects
- A protected lane where two deliveries with one request ID create one effect
- A separately served synthetic staging Worker with opaque leased capabilities, exact two-invocation run limits, exact-origin CORS, and a reset allocation guard
- Final-state proof that reports known-bad `2 calls / 2 effects` versus protected `2 calls / 1 effect` and binds its receipt to the exact trial, digest, request ID, deployment, generated UUID effect IDs, and evidence digests
- Four supporting deterministic fixtures for booking drift, duplicate refunds, cloud false success, and social-publish false success
- A visible bug-sensitivity check and safe recovery path for each supporting fixture
- A blocked-by-default External Target staging protocol, browser client, same-origin broker, and optional tool-registration gate
- A headless `bin/action-check` CLI (v0) that runs the same comparison from outside the page in real Chrome with the WebMCP flag and cross-checks tool claims against a caller-supplied independent `observe()`
- An external-target mode for that CLI (v0.1): any page's registered WebMCP tool, called once or twice with identical input, verdict taken only from before/after observations of that page's own state; demonstrated on a page Action Check does not own
- Browser interface, accessibility behavior, automated tests, public-boundary controls, and release documentation

## Independence and data origin

This is a fresh independent implementation. No pre-existing application source was imported. No private systems, source, history, credentials, production logic, incident records, agent traces, customer data, or telemetry were used.

Every payment, case, account alias, provider, service, post, event, state, attempt, effect, request ID, finding, rule, metric, and receipt is fictional or generated for the synthetic staging sandbox. External effect IDs are random UUIDs. The scenarios are evidence-informed product hypotheses; they are not customer interviews, measured production demand, or real incidents.

The refund proof reads leased SQLite Durable Object state separately from the action response. The Worker is external to the browser session but remains an Action Check-owned synthetic fixture. It is not a record from a payment processor, independent third-party attestation, or a test of another team's registered WebMCP tool. It is publicly deployed and verified only as bounded synthetic judging infrastructure.

AI-assisted research, design, implementation, and review are part of the recorded build process. The entrant remains responsible for product decisions, verification, licensing, accuracy, and submission.

## Visual asset provenance

Eleven binary visual assets currently sit outside the source-code text scan:

| Asset | Origin | Release use |
|---|---|---|
| `docs/design/action-assurance-lab-concept.png` | Generated for this project with OpenAI image generation on 2026-08-30 | Historical visual-system concept; not final submission evidence |
| `docs/design/workbench-awaiting-approval-concept.png` | Generated for this project with OpenAI image generation on 2026-08-29 | Historical OAuth concept; do not use in the final submission |
| `docs/design/workbench-receipt-ready-concept.png` | Generated for this project with OpenAI image generation on 2026-08-29 | Historical OAuth concept; do not use in the final submission |
| `docs/screenshots/action-assurance-duplicate-proof.jpg` | Direct local browser capture of a synthetic build | Historical pre-refund-hero screenshot; recapture before submission |
| `docs/screenshots/action-assurance-false-success-mobile.jpg` | Direct local mobile browser capture of a synthetic build | Historical pre-refund-hero screenshot; recapture before submission |
| `docs/screenshots/workbench-receipt-ready.png` | Direct local browser capture of the earlier OAuth build | Historical only; the file contains JPEG data despite its `.png` suffix |
| `docs/screenshots/external-staging-refund-proof.png` | Direct local browser capture of the integrated app-to-Worker proof on 2026-08-31 | Current local QA evidence; recapture from the deployed release before submission |
| `docs/screenshots/action-check-live-discovery.jpg` | Direct Chrome 152 (WebMCP flag, Playwright) capture of the deployed release on 2026-09-03; replaced the 2026-09-01 in-app-browser capture when the light interface shipped | Final discovery/tool-surface evidence |
| `docs/screenshots/action-check-live-approval.jpg` | Direct Chrome 152 (WebMCP flag, Playwright) capture of the deployed release on 2026-09-03; replaced the 2026-09-01 capture | Final human-approval evidence |
| `docs/screenshots/action-check-live-proof.jpg` | Direct Chrome 152 (WebMCP flag, Playwright) capture of the deployed release on 2026-09-03; replaced the 2026-09-01 capture | Final 2-versus-1 outcome evidence |
| `docs/screenshots/action-check-live-simulated-fallback.jpg` | Direct Chrome 152 (no WebMCP flag, Playwright) capture of the deployed release on 2026-09-03 | Final fallback-state evidence for browsers without WebMCP |

An ExifTool review on 2026-08-31 found no populated EXIF, IPTC, or XMP fields in the seven files then present. The four `action-check-live-*.jpg` captures from the 2026-09-03 build were reviewed the same way on 2026-09-03: only File, JFIF, and an sRGB ICC colour profile are present; no EXIF, IPTC, or XMP fields. A visual review found no people, real customer records, or third-party logos. Every video frame still requires a fresh manual review from the exact submitted build.

## Claims boundary

- The main demo proves one Action Check-owned synthetic refund comparison with an external durable outcome plane; it does not test another team's registration or prove a production payment integration or general exactly-once delivery.
- The four supporting cases show the verification pattern across domains; they are not four live integrations.
- WebMCP supplies the browser tool boundary, not the approval, idempotency, or postcondition guarantee.
- The External Target adapter is disconnected. No live staging or public-provider result is claimed.
- Native registration tests do not substitute for agent discovery and invocation in the exact judging client.
- Public repository: https://github.com/ajaknumber4/action-check-webmcp (published as snapshot commits — the initial 2026-09-01 release and subsequent snapshots — while the private working history behind them is the commit table above). Deployment: live (see table). Video and Devpost submission: in progress on 2026-09-01; the Devpost project stays a draft until both are complete.

## Evidence to preserve

- Dated commit history from the first implementation commit through the submission tag
- The research and decision records supporting the product pivot
- Exact dependency and licence inventory
- Final frozen-build unit, DOM, browser, accessibility, native WebMCP, and judging-client results
- Public-boundary, full-history secret, and independent personal-information scan results
- Metadata and visual review results for every public asset
- Screenshots and video captured from the exact submitted build
- Exact public repository URL, deployment identifier, video URL, and submitted repository tag

The pending release rows must be updated only with actual URLs, identifiers, and timestamps. They must never be backfilled with estimates.
