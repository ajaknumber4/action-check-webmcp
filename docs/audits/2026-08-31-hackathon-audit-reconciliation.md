# WebMCP hackathon audit reconciliation

Date: 2026-08-31

This report reconciles the earlier pre-hero hackathon audit with the current Action Check worktree. The earlier audit remains useful product research, but its implementation inventory and several recommendations are now stale.

## Current verdict

Keep the use case and freeze the product direction. Action Check now demonstrates one concrete claim: a person approves an exact synthetic refund trial, an agent invokes a registered mutating WebMCP target, and response-independent ledger evidence distinguishes a duplicate effect from an idempotent retry.

The local build is credible but not releasable yet. It still lacks a frozen public commit, remote repository, public HTTPS deployment, interactive judging-client evidence, final screenshots, public video, and submitted Devpost entry.

## Finding-by-finding status

| Earlier finding | Current status | Resolution or remaining action |
|---|---|---|
| Effect testing is a suitable differentiated WebMCP use case | **Confirmed** | Keep the refund retry as the hero and the four cross-industry cases as supporting synthetic examples. |
| The mutating actions were only fixture labels | **Resolved for the hero** | `issue_refund` is now a registered WebMCP target. `stage_refund_comparison` and `prove_refund_comparison` complete the three-tool agent path. The four supporting cases remain deliberately UI-only and are labelled as such. |
| WebMCP was visually hidden | **Resolved** | An always-visible **Agent tools** strip lists the exact three default tools and shows truthful Ready, Registering, Unavailable, or Failed state plus registered count. |
| Supporting cases preceded the hero on small screens | **Resolved** | Semantic order is now hero → UI-only suite → supporting details. A 375×667 browser gate requires the full Agent tools strip to remain in the first viewport. |
| “Real check not connected” looked unfinished | **Resolved** | The disconnected External Target panel now says **Optional staging integration** and **Optional external-target staging · disabled**. It has no dead run control, and its visible copy identifies the lower case as a UI-only synthetic fixture. |
| Add `navigator.modelContext` fallback | **Rejected after primary-source review** | The current draft, official README, and Chrome guide use `document.modelContext`. The navigator shape is obsolete history. Keep the aligned adapter and test the deployed URL in the actual judging client. See `2026-08-31-webmcp-api-runtime-followup.md`. |
| Native WebMCP had not been tested | **Resolved locally, open in judging client** | Installed Chrome native discovery and invocation pass locally. A deployed interactive agent run remains mandatory because browser-to-agent exposure is implementation-defined. |
| No remote, deployment, or release commit | **Open release blocker** | Obtain explicit public-release approval, freeze the exact commit, rerun scans and tests, create the public repository, and deploy the same build. |
| No demo video | **Open release blocker** | Record the deployed three-tool flow in under three minutes after the judging-client gate passes. |
| Stale screenshots | **Open release blocker** | Replace the historical images with final desktop, mobile, approval, and 2/2-versus-2/1 proof captures from the deployed build. |
| Another entry might be a sibling of this one | **No supporting evidence** | Checked and dismissed. Other entries are treated as independent work. The working note naming a specific project was removed rather than published. |

## Product distinction

Some adjacent entries review a proposed change before it is applied. Action Check invokes a registered mutating WebMCP action, injects a retry failure, and checks the resulting effect state with a negative control. The distinction is outcome verification after an action, not generic human approval before one.

## Release order

1. Run the complete local verification suite against the reconciled UI.
2. Obtain the required independent maker-checker review and explicit approval to publish.
3. Confirm the final name, create a signed release commit, and rerun the exact-commit tests and public-boundary scans.
4. Push to a public repository and deploy the same commit over HTTPS.
5. Run and record discovery plus invocation through the actual judging client.
6. Capture final screenshots and record the public demo video.
7. Replace every Devpost placeholder, submit, and verify the project state is **Submitted** rather than Draft.

## Evidence boundary

The default build remains synthetic and browser-local. It proves the test design and WebMCP interaction, not a real payment-provider guarantee. The optional External Target canary remains excluded from product claims unless its separate staging attestation and live-evidence gate are completed.
