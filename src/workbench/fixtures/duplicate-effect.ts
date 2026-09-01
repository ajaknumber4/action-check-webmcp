import type { SafeAssuranceCase } from "../interface";

export const DUPLICATE_EFFECT_CASE_ID = "agent-action-duplicate-01";

export const duplicateEffectCase: SafeAssuranceCase = Object.freeze({
  id: DUPLICATE_EFFECT_CASE_ID,
  kind: "duplicate_effect",
  title: "One request created two social posts",
  objective: "Publish the approved social post once.",
  synthetic: true,
  safetyNotice: "Synthetic fixtures · No production effects · Sensitive values redacted",
  summary: Object.freeze([
    Object.freeze({
      id: "requested-action",
      label: "Goal",
      value: "Publish one approved post",
    }),
    Object.freeze({
      id: "target",
      label: "Example",
      value: "Demo social post P-204",
    }),
    Object.freeze({
      id: "observed-result",
      label: "What went wrong",
      value: "One request created two posts",
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
      id: "request-observed",
      label: "Publish requested",
      status: "completed" as const,
      detail: "The agent requested one demo post.",
    }),
    Object.freeze({
      id: "first-effect",
      label: "First post created",
      status: "completed" as const,
      detail: "The first attempt created the post.",
    }),
    Object.freeze({
      id: "retry-effect",
      label: "Retry created another post",
      status: "blocked" as const,
      detail: "The retry repeated the same publish request.",
    }),
    Object.freeze({
      id: "invariant-failed",
      label: "Duplicate detected",
      status: "blocked" as const,
      detail: "One requested post appeared twice.",
    }),
  ]),
});
