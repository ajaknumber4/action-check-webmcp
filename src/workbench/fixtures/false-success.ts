import type { SafeAssuranceCase } from "../interface";

export const FALSE_SUCCESS_CASE_ID = "agent-action-false-success-01";

export const falseSuccessCase: SafeAssuranceCase = Object.freeze({
  id: FALSE_SUCCESS_CASE_ID,
  kind: "false_success",
  title: "The tool said posted, but the post stayed draft",
  objective: "Check whether the approved social post actually went live.",
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
      value: "Demo social post P-205",
    }),
    Object.freeze({
      id: "observed-result",
      label: "What went wrong",
      value: "Tool said published; post stayed draft",
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
      id: "publish-invoked",
      label: "Publish requested",
      status: "completed" as const,
      detail: "The demo publish action received a valid request.",
    }),
    Object.freeze({
      id: "success-returned",
      label: "Tool said done",
      status: "completed" as const,
      detail: "The tool returned a successful response.",
    }),
    Object.freeze({
      id: "state-read",
      label: "Post status checked",
      status: "completed" as const,
      detail: "The demo platform state was read after completion.",
    }),
    Object.freeze({
      id: "still-draft",
      label: "Post remained draft",
      status: "blocked" as const,
      detail: "The actual post status contradicted the tool response.",
    }),
  ]),
});
