import { socialPublishCase } from "../fixtures/social-publish";
import type { AssuranceFinding, OutcomeProofView } from "../interface";
import type { AssuranceScenarioDefinition } from "./definition";
import { freezePlan } from "./definition";

export const SOCIAL_PUBLISH_FINDING_ID = "finding-social-publish-01";

export const socialPublishFinding: AssuranceFinding = Object.freeze({
  id: SOCIAL_PUBLISH_FINDING_ID,
  category: "social_publish",
  severity: "blocking",
  title: "The publish response does not match the post state",
  summary: "The tool says live while the platform still stores a draft.",
  failedInvariant: "Report publish success only after the post is live.",
  evidence: Object.freeze([Object.freeze({ label: "Post status", expected: "Published", observed: "Draft" })]),
  smallestSafeCorrection: "Read the platform status after publish and reject a contradictory success response.",
  confidence: "high",
  requiresHumanApproval: true,
  repairAvailable: true,
});

export const socialPublishScenario: AssuranceScenarioDefinition = Object.freeze({
  safeCase: socialPublishCase,
  finding: socialPublishFinding,
  patch: Object.freeze({
    patchId: "contract-social-postcondition-01",
    field: "completion_policy" as const,
    fieldLabel: "Success policy",
    before: "Trust the publish response",
    recommendedAfter: "Require a published state read",
    permittedValues: Object.freeze(["Trust the publish response", "Require a published state read"]),
  }),
  plan(patch) {
    const verifiesState = patch.after === "Require a published state read";
    return freezePlan([
      { id: "read-before", label: "Read approved post", status: "passed", detail: "Captured the approved content and version." },
      { id: "invoke-tool", label: "Run publish", status: "passed", detail: "The publish tool returns success." },
      { id: "read-after", label: "Read platform state", status: "passed", detail: "The authoritative platform state remains Draft." },
      { id: "check-postcondition", label: "Compare result", status: verifiesState ? "passed" : "failed", detail: verifiesState ? "The false publish success is rejected." : "The draft post is reported as live." },
    ]);
  },
  createRuntime(patch) {
    const verifiesState = patch.after === "Require a published state read";
    let toolCompleted = false;
    let status: "unknown" | "draft" = "unknown";
    let claimRejected = false;
    return Object.freeze({
      record(step) {
        if (step.id === "invoke-tool") toolCompleted = true;
        if (step.id === "read-after") status = "draft";
        if (step.id === "check-postcondition") claimRejected = verifiesState && status === "draft";
      },
      evaluate() {
        const passed = toolCompleted && status === "draft" && claimRejected;
        const proof: OutcomeProofView = Object.freeze({
          status: passed ? "passed" : "failed",
          disposition: passed ? "false_success_detected" : "invariant_failed",
          businessOutcome: passed ? "not_achieved" : "unsafe",
          invariant: socialPublishFinding.failedInvariant,
          summary: passed ? "The tool said live, but the Draft state caused the success claim to be rejected." : "The publish response was trusted even though the post remained Draft.",
          metrics: Object.freeze([
            Object.freeze({ label: "Tool said live", value: toolCompleted ? "Yes" : "No" }),
            Object.freeze({ label: "Platform state", value: status === "draft" ? "Draft" : "Unknown" }),
            Object.freeze({ label: "False success rejected", value: claimRejected ? "Yes" : "No" }),
          ]),
          evidence: Object.freeze([Object.freeze({ label: "Post status", expected: "Published", observed: status === "draft" ? "Draft" : "Unknown" })]),
        });
        return Object.freeze({ residualFindings: passed ? Object.freeze([]) : Object.freeze([socialPublishFinding]), proof });
      },
    });
  },
});
