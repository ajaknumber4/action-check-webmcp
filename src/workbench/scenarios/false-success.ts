import { falseSuccessCase } from "../fixtures/false-success";
import type {
  AssuranceFinding,
  OutcomeProofView,
} from "../interface";
import type { AssuranceScenarioDefinition } from "./definition";
import { freezePlan } from "./definition";

export const FALSE_SUCCESS_FINDING_ID = "finding-false-success-01";

export const falseSuccessFinding: AssuranceFinding = Object.freeze({
  id: FALSE_SUCCESS_FINDING_ID,
  category: "false_success",
  severity: "blocking",
  title: "The tool said posted, but the post is still draft",
  summary: "The tool returned success before checking the platform.",
  failedInvariant: "Only say Published after the post is actually live.",
  evidence: Object.freeze([
    Object.freeze({
      label: "Post status",
      expected: "Published",
      observed: "Draft",
    }),
  ]),
  smallestSafeCorrection: "Read the platform status before reporting success.",
  confidence: "high",
  requiresHumanApproval: true,
  repairAvailable: true,
});

export const falseSuccessScenario: AssuranceScenarioDefinition = Object.freeze({
  safeCase: falseSuccessCase,
  finding: falseSuccessFinding,
  patch: Object.freeze({
    patchId: "patch-completion-policy-01",
    field: "completion_policy" as const,
    fieldLabel: "Success check",
    before: "Trust the tool response",
    recommendedAfter: "Check the live post first",
    permittedValues: Object.freeze([
      "Trust the tool response",
      "Check the live post first",
    ]),
  }),
  plan(patch) {
    const checksPostcondition =
      patch.after === "Check the live post first";
    return freezePlan([
      {
        id: "invoke-tool",
        label: "Run publish",
        status: "passed",
        detail: "The demo publish tool completed normally.",
      },
      {
        id: "capture-claim",
        label: "Hold success claim",
        status: "passed",
        detail: "Held the tool response until the post could be checked.",
      },
      {
        id: "read-state",
        label: "Check post status",
        status: "passed",
        detail: "Read the post status from the demo platform.",
      },
      {
        id: "verify-postcondition",
        label: "Compare result",
        status: checksPostcondition ? "passed" : "failed",
        detail: checksPostcondition
          ? "The Draft status stopped the tool response being shown as success."
          : "The tool response was trusted without checking the post.",
      },
    ]);
  },
  createRuntime(patch) {
    const checksPostcondition =
      patch.after === "Check the live post first";
    let toolCompleted = false;
    let claimCaptured = false;
    let authoritativeState: "unknown" | "draft" | "published" = "unknown";

    return Object.freeze({
      record(step) {
        if (step.id === "invoke-tool") toolCompleted = true;
        if (step.id === "capture-claim") claimCaptured = true;
        if (step.id === "read-state") authoritativeState = "draft";
      },
      evaluate() {
        const detected =
          checksPostcondition &&
          toolCompleted &&
          claimCaptured &&
          authoritativeState === "draft";
        const goalAchieved = authoritativeState === "published";
        const proof: OutcomeProofView = Object.freeze({
          status: detected ? "passed" : "failed",
          disposition: detected ? "false_success_detected" : "invariant_failed",
          businessOutcome: detected ? "not_achieved" : "unsafe",
          invariant: falseSuccessFinding.failedInvariant,
          summary: detected
            ? "The tool said done, but the post was still Draft. The success claim was rejected."
            : "The tool response was trusted even though the post was still Draft.",
          metrics: Object.freeze([
            Object.freeze({
              label: "Tool said done",
              value: toolCompleted ? "Yes" : "No",
            }),
            Object.freeze({
              label: "Post went live",
              value: goalAchieved ? "Yes" : "No",
            }),
            Object.freeze({
              label: "False success caught",
              value: detected ? "Yes" : "No",
            }),
          ]),
          evidence: Object.freeze([
            Object.freeze({
              label: "Post status",
              expected: "Published",
              observed: authoritativeState === "draft" ? "Draft" : "Unknown",
            }),
          ]),
        });
        return Object.freeze({
          residualFindings: detected
            ? Object.freeze([])
            : Object.freeze([falseSuccessFinding]),
          proof,
        });
      },
    });
  },
});
