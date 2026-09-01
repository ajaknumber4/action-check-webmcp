import { cloudFalseSuccessCase } from "../fixtures/cloud-false-success";
import type { AssuranceFinding, OutcomeProofView } from "../interface";
import type { AssuranceScenarioDefinition } from "./definition";
import { freezePlan } from "./definition";

export const CLOUD_FALSE_SUCCESS_FINDING_ID = "finding-cloud-false-success-01";

export const cloudFalseSuccessFinding: AssuranceFinding = Object.freeze({
  id: CLOUD_FALSE_SUCCESS_FINDING_ID,
  category: "cloud_false_success",
  severity: "blocking",
  title: "The operation response does not match service health",
  summary: "The deploy operation says done while the service remains unhealthy.",
  failedInvariant: "Report deployment success only after the service is healthy.",
  evidence: Object.freeze([Object.freeze({ label: "Service health", expected: "Healthy", observed: "Unhealthy" })]),
  smallestSafeCorrection: "Read service health after the operation and reject a contradictory success response.",
  confidence: "high",
  requiresHumanApproval: true,
  repairAvailable: true,
});

export const cloudFalseSuccessScenario: AssuranceScenarioDefinition = Object.freeze({
  safeCase: cloudFalseSuccessCase,
  finding: cloudFalseSuccessFinding,
  patch: Object.freeze({
    patchId: "contract-cloud-postcondition-01",
    field: "completion_policy" as const,
    fieldLabel: "Success policy",
    before: "Trust the operation response",
    recommendedAfter: "Require a healthy service read",
    permittedValues: Object.freeze(["Trust the operation response", "Require a healthy service read"]),
  }),
  plan(patch) {
    const verifiesState = patch.after === "Require a healthy service read";
    return freezePlan([
      { id: "read-before", label: "Read current release", status: "passed", detail: "Captured the service state before deployment." },
      { id: "invoke-tool", label: "Run deployment", status: "passed", detail: "The operation returns done." },
      { id: "read-after", label: "Read service health", status: "passed", detail: "The authoritative control plane reports Unhealthy." },
      { id: "check-postcondition", label: "Compare result", status: verifiesState ? "passed" : "failed", detail: verifiesState ? "The contradictory success claim is rejected." : "The unhealthy service is reported as successfully deployed." },
    ]);
  },
  createRuntime(patch) {
    const verifiesState = patch.after === "Require a healthy service read";
    let toolCompleted = false;
    let health: "unknown" | "unhealthy" = "unknown";
    let claimRejected = false;
    return Object.freeze({
      record(step) {
        if (step.id === "invoke-tool") toolCompleted = true;
        if (step.id === "read-after") health = "unhealthy";
        if (step.id === "check-postcondition") claimRejected = verifiesState && health === "unhealthy";
      },
      evaluate() {
        const passed = toolCompleted && health === "unhealthy" && claimRejected;
        const proof: OutcomeProofView = Object.freeze({
          status: passed ? "passed" : "failed",
          disposition: passed ? "false_success_detected" : "invariant_failed",
          businessOutcome: passed ? "not_achieved" : "unsafe",
          invariant: cloudFalseSuccessFinding.failedInvariant,
          summary: passed ? "The operation said done, but the unhealthy service state caused the tool to report failure." : "The operation response was trusted even though the service remained unhealthy.",
          metrics: Object.freeze([
            Object.freeze({ label: "Operation said done", value: toolCompleted ? "Yes" : "No" }),
            Object.freeze({ label: "Service health", value: health === "unhealthy" ? "Unhealthy" : "Unknown" }),
            Object.freeze({ label: "False success rejected", value: claimRejected ? "Yes" : "No" }),
          ]),
          evidence: Object.freeze([Object.freeze({ label: "Authoritative health", expected: "Healthy", observed: health === "unhealthy" ? "Unhealthy" : "Unknown" })]),
        });
        return Object.freeze({ residualFindings: passed ? Object.freeze([]) : Object.freeze([cloudFalseSuccessFinding]), proof });
      },
    });
  },
});
