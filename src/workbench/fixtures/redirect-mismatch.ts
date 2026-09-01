import type { SafeOAuthCase } from "../interface";

export const REDIRECT_MISMATCH_CASE_ID = "oauth-demo-redirect-01";

export const redirectMismatchCase: SafeOAuthCase = Object.freeze({
  id: REDIRECT_MISMATCH_CASE_ID,
  kind: "stale_approval",
  title: "Connection setting changed after approval",
  objective: "Reconnect the social account using the setting the person approved.",
  providerName: "Northstar Social",
  applicationName: "Demo Publisher",
  synthetic: true,
  safetyNotice: "Synthetic data · Secrets redacted before agent access",
  registeredRedirectUri: "https://demo.example.com/oauth/callback",
  observedRedirectUri: "https://demo.example.com/oauth/callback/",
  summary: Object.freeze([
    Object.freeze({
      id: "requested-action",
      label: "Goal",
      value: "Reconnect a social account",
    }),
    Object.freeze({
      id: "target",
      label: "Example",
      value: "Demo account · Northstar Social",
    }),
    Object.freeze({
      id: "observed-result",
      label: "What went wrong",
      value: "The callback changed after approval",
      emphasis: "danger" as const,
    }),
    Object.freeze({
      id: "production-effect",
      label: "Real changes",
      value: "None — demo only",
    }),
  ]),
  timeline: Object.freeze([
    Object.freeze({
      id: "approval-captured",
      label: "Connection setting approved",
      status: "completed" as const,
      detail: "The person approved one exact callback value.",
    }),
    Object.freeze({
      id: "state-observed",
      label: "Current setting checked",
      status: "completed" as const,
      detail: "The current callback now has one extra trailing slash.",
    }),
    Object.freeze({
      id: "drift-detected",
      label: "Approved setting changed",
      status: "blocked" as const,
      detail: "The current callback no longer matches what the person approved.",
    }),
    Object.freeze({
      id: "validate",
      label: "Connection blocked",
      status: "blocked" as const,
      detail: "The mismatched callback stopped the connection.",
    }),
    Object.freeze({
      id: "token",
      label: "Token",
      status: "pending" as const,
      detail: "Not attempted because the connection setting was unsafe.",
    }),
    Object.freeze({
      id: "connected",
      label: "Connected",
      status: "pending" as const,
      detail: "Waiting for an approved setting that matches.",
    }),
  ]),
});
