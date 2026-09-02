# Public-release security and privacy audit

**Date:** 2026-09-01
**Scope:** Candidate public repository, React/Vite browser app, optional Node staging broker, Cloudflare Worker, lockfiles, commit history, and seven binary assets. Local secret files and authentication stores were excluded and not read.

## Executive summary

**Verdict: PASS for public release, with no Critical or High finding.**

The candidate public file set contains no detected credential or personal-information leak. Both dependency trees report zero known vulnerabilities. The refund Worker has strong bounds around input, capability lifetime, mutation count, evidence, CORS, and cleanup. Its production environment names one exact HTTPS frontend origin and an immutable release deployment ID. The public repository is published from a new, sanitized release root so older local author metadata is not exposed.

Two Medium, non-blocking hardening items remain: treat the anonymous reset route as cost-abuse exposure rather than authentication, and keep the optional External Target broker disabled unless it receives real caller authentication and rate limiting. The frontend now ships the exact release CSP and required security headers. None of the residual items can create a real refund or provider effect in the submitted synthetic configuration.

| Severity | Count | Release effect |
|---|---:|---|
| Critical | 0 | None |
| High | 0 | None |
| Medium | 2 | Hardening / conditional operational risk |
| Low | 0 | None |

## Medium findings

### Resolved — Frontend Content Security Policy and release headers

- **Rule ID:** REACT-CSP-001 / REACT-HEADERS-001
- **Severity:** Resolved before release
- **Location:** `vercel.json:7-28`; app entrypoint `index.html:1-16`
- **Evidence:** `vercel.json` defines `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, a constrained `Permissions-Policy`, and an exact `Content-Security-Policy` whose `connect-src` names only the deployed Worker origin. The live stable URL returned the same CSP and headers on 2026-09-01.
- **Resolution:** The deployed policy is:

  ```text
  default-src 'self'; base-uri 'none'; connect-src 'self' https://action-check-refund-staging-target-production.ancient-dust-0cb4.workers.dev; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'; upgrade-insecure-requests
  ```

  It contains no `unsafe-inline`, `unsafe-eval`, wildcard `connect-src`, or `model-context=()` restriction. Native WebMCP discovery and the complete refund proof passed after deployment in both the ChatGPT in-app browser and installed Chrome 152.
- **Mitigation:** Existing React escaping, absence of dangerous sinks, self-hosted dependencies/fonts, no public source maps (`vite.config.ts:7-9`), and exact target URL validation reduce current risk.
- **Runtime verification:** the stable Vercel URL returned HTTP 200 plus the exact CSP, HSTS, `nosniff`, `DENY`, `no-referrer`, and the constrained device policy. The complete live WebMCP journey produced zero browser warnings/errors.

### SEC-002 — Public reset allocation is rate-limited but not authenticated

- **Rule ID:** CF-ABUSE-001
- **Severity:** Medium (operational/cost abuse)
- **Location:** `workers/refund-staging-target/src/index.ts:455-496`; `workers/refund-staging-target/wrangler.jsonc:46-59`
- **Evidence:** `/v1/reset` requires an exact configured `Origin` and passes through a Cloudflare rate-limit binding before two Durable Objects are allocated. The limiter key is the shared allowed-origin string. An arbitrary server client can forge an `Origin` header; CORS is a browser read policy, not caller authentication.
- **Impact:** Distributed callers could allocate more short-lived synthetic runs than the nominal 20 resets per 10 seconds, consuming Worker/Durable Object quota or reducing judge availability. The runs expire after 900 seconds, store fictional data only, and each run independently permits at most two mutations.
- **Fix:** Preserve the no-login judge flow, but add an account/zone-level IP or bot-abuse rule and a spend alert/cap for the event window. A longer-lived product should mint a short-lived reset capability from an authenticated backend or enforce a global allocation budget in authoritative state.
- **Mitigation:** Exact-origin response CORS, bounded JSON, pre-allocation rate limiting, 256-bit per-run bearer capabilities, hashed routing/storage, lease alarms, explicit cleanup, and the Durable Object call ceiling substantially constrain impact.
- **False-positive notes:** Cloudflare rate limiting is intentionally permissive/eventually consistent and must not be described as strict global accounting. This is not a payment or data-integrity vulnerability in the synthetic fixture.

### SEC-003 — Optional External Target broker uses forgeable browser headers as its only caller gate

- **Rule ID:** SERVER-AUTHZ-001
- **Severity:** Medium, conditional on enabling the broker
- **Location:** `server/external-target-staging/broker.ts:50-135`, especially `server/external-target-staging/broker.ts:75-99` and `server/external-target-staging/broker.ts:238-251`
- **Evidence:** The broker checks `Sec-Fetch-Site`, a custom header, `Origin`, and `Host`, then accepts a caller-supplied request ID. Those headers prevent ordinary cross-site browser requests but can be forged by a direct HTTP client. There is no authenticated user/session or durable request-rate limit at this boundary.
- **Impact:** If deployed publicly with the server-side staging credential, an external caller could repeatedly trigger isolated canary work. Attestation prevents live-provider operation, but compute/staging quota and availability remain exposed.
- **Fix:** Keep this integration disabled in the public static submission, as currently documented. Before any later enablement, add real caller authorization (for example a signed one-time nonce from an authenticated backend), durable idempotency, and an edge rate limit. Keep the existing environment/provider attestation as a separate safety control.
- **Mitigation:** The browser cannot choose the target URL or credential; the credential remains server-only; exact staging identity, isolated database, canary sink, absent live credentials, and disabled provider egress are required before mutation.
- **False-positive notes:** The current Vite production artifact is static and the submission states that this integration is disabled. This finding becomes actionable only if a runtime server route and staging environment variables are deployed.

## Verified controls

### Secrets, privacy, and publication boundary

- `npm run check:public` passed: 136 candidate text files scanned.
- Gitleaks candidate-public scan passed on a clean export of tracked plus non-ignored untracked files.
- Gitleaks found no secret in the four local commits. The local author metadata was not used as a publication boundary; the public release is exported to a new root commit with the approved business address.
- Independent high-confidence token/private-key patterns returned no candidate-public match.
- No personal home-directory path, private customer/account identifier, or non-example email was found. The one email fixture uses `example.com` and deliberately tests redaction.
- Secret/environment/key paths are excluded by `.gitignore:9-17` and `.vercelignore:12-20`; excluded generated artifacts were not treated as publication candidates.

### Frontend

- No `dangerouslySetInnerHTML`, direct HTML injection sink, `eval`, `new Function`, string event handler, `postMessage`, service worker, third-party script, or Web Storage use was found.
- Cross-origin Worker requests use `credentials: "omit"`, reject redirects, enforce HTTPS outside loopback, use a fixed origin without credentials/path/query/fragment, validate bounded responses, and parse strict schemas (`src/integrations/external-effect-staging/browser-target.ts:112-357`).
- Production source maps are disabled (`vite.config.ts:7-9`).
- Vercel installs reproducibly with `npm ci` and defines the exact CSP, `nosniff`, `DENY`, `no-referrer`, and a least-privilege device Permissions Policy (`vercel.json`).

### Refund staging Worker

- Strict path, method, content type, exact-origin, schema, field-count, character, numeric, and 16 KiB body limits are enforced before mutation (`workers/refund-staging-target/src/index.ts:448-505`, `workers/refund-staging-target/src/index.ts:686-827`).
- Per-run authorization uses 32 random bytes, hashes capabilities for routing/storage, compares hashes with a timing-safe primitive, binds exact lane/request/trial/attestation/lease metadata, and expires through a Durable Object alarm (`workers/refund-staging-target/src/index.ts:116-215`, `workers/refund-staging-target/src/index.ts:281-348`, `workers/refund-staging-target/src/index.ts:851-885`).
- Mutation count is independently capped at two and protected-lane uniqueness is enforced in SQLite (`workers/refund-staging-target/src/index.ts:155-272`).
- Responses are `no-store`, `nosniff`, exact-origin, non-credentialed CORS responses (`workers/refund-staging-target/src/index.ts:954-966`).
- Production configuration uses one exact HTTPS app origin, a 900-second lease, distinct rate-limit namespace, and release deployment identity (`workers/refund-staging-target/wrangler.jsonc:36-60`). The final live origin must equal the Vercel alias exactly.
- The Worker test suite passed 11/11, including CORS, strict JSON, mutation ceilings, concurrency, capability expiry, cleanup, and reset limiting.

### Dependencies and assets

- Root `npm audit` and production-only `npm audit --omit=dev` returned zero vulnerabilities at every severity across 171 packages.
- Worker `npm audit` returned zero vulnerabilities across 160 packages.
- Both lockfiles contain a licence field for every package. LGPL libvips packages are build/test transitive dependencies, not browser or Worker runtime code.
- All seven binary assets have zero populated EXIF, IPTC, or XMP fields. Visual review found only fictional/example data, no person, customer record, private identifier, credential, or third-party logo.
- `git diff --check` passed.

## Release gate

No security or privacy blocker prevents repository publication or deployment. Before the Devpost submit call:

1. Confirm the optional External Target broker remains absent/disabled in the deployed static artifact.
2. Keep SEC-002 documented as residual synthetic-demo abuse risk and enable Cloudflare usage alerts for the judging window.

Completed release checks: exact live security headers returned; a non-allowlisted origin received HTTP 403 with no CORS grant; the live frontend completed both lanes and final proof; Chrome 152 native WebMCP and 16/16 deployed browser journeys passed.
