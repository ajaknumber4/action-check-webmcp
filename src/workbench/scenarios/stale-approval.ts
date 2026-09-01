import { redirectMismatchCase } from "../fixtures/redirect-mismatch";
import type {
  AssuranceFinding,
  OutcomeProofView,
} from "../interface";
import type { AssuranceScenarioDefinition } from "./definition";
import { freezePlan } from "./definition";

export const REDIRECT_MISMATCH_FINDING_ID = "finding-redirect-uri-01";

const expectedRedirect = redirectMismatchCase.registeredRedirectUri!;
const observedRedirect = redirectMismatchCase.observedRedirectUri!;

export const redirectMismatchFinding: AssuranceFinding = Object.freeze({
  id: REDIRECT_MISMATCH_FINDING_ID,
  category: "redirect_uri",
  severity: "blocking",
  title: "The approved connection setting changed",
  summary: "The current callback has one extra trailing slash.",
  failedInvariant: "Use the exact callback value the person approved.",
  evidence: Object.freeze([
    Object.freeze({
      label: "Connection setting",
      expected: expectedRedirect,
      observed: observedRedirect,
    }),
  ]),
  smallestSafeCorrection: "Restore the approved callback and ask again if it changes.",
  confidence: "high",
  requiresHumanApproval: true,
  repairAvailable: true,
});

export const staleApprovalScenario: AssuranceScenarioDefinition = Object.freeze({
  safeCase: redirectMismatchCase,
  finding: redirectMismatchFinding,
  patch: Object.freeze({
    patchId: "patch-redirect-uri-01",
    field: "observed_redirect_uri" as const,
    fieldLabel: "Connection callback",
    before: observedRedirect,
    recommendedAfter: expectedRedirect,
    permittedValues: Object.freeze([expectedRedirect, observedRedirect]),
  }),
  plan(patch) {
    const willMatch = patch.after === expectedRedirect;
    return freezePlan([
      {
        id: "capture-state",
        label: "Read current setting",
        status: "passed",
        detail: "Read the current callback and approved version.",
      },
      {
        id: "bind-approval",
        label: "Match approval",
        status: "passed",
        detail: "Matched the test to the exact approved change.",
      },
      {
        id: "apply-guardrail",
        label: "Apply in demo",
        status: "passed",
        detail: "Applied the approved callback to the demo only.",
      },
      {
        id: "verify-callback",
        label: "Test connection",
        status: willMatch ? "passed" : "failed",
        detail: willMatch
          ? "The callback now matches the registered value."
          : "The callback still differs from the registered value.",
      },
    ]);
  },
  createRuntime(patch) {
    let stateCaptured = false;
    let approvalBound = false;
    let appliedRedirect = observedRedirect;
    let outcomeChecked = false;

    return Object.freeze({
      record(step) {
        if (step.id === "capture-state") stateCaptured = true;
        if (step.id === "bind-approval") {
          approvalBound = patch.ref.caseId === redirectMismatchCase.id;
        }
        if (step.id === "apply-guardrail" && approvalBound) {
          appliedRedirect = patch.after;
        }
        if (step.id === "verify-callback") outcomeChecked = true;
      },
      evaluate() {
        const passed =
          stateCaptured &&
          approvalBound &&
          outcomeChecked &&
          appliedRedirect === expectedRedirect;
        const proof: OutcomeProofView = Object.freeze({
          status: passed ? "passed" : "failed",
          disposition: passed ? "intended_outcome_verified" : "invariant_failed",
          businessOutcome: passed ? "achieved" : "not_achieved",
          invariant: redirectMismatchFinding.failedInvariant,
          summary: passed
            ? "The approved callback now matches and the demo connection succeeds."
            : "The callback still does not match, so the connection remains blocked.",
          metrics: Object.freeze([
            Object.freeze({
              label: "Approval matched",
              value: approvalBound ? "Yes" : "No",
            }),
            Object.freeze({
              label: "Callback matched",
              value: passed ? "Yes" : "No",
            }),
            Object.freeze({ label: "Real changes", value: "0" }),
          ]),
          evidence: Object.freeze([
            Object.freeze({
              label: "Final callback",
              expected: expectedRedirect,
              observed: appliedRedirect,
            }),
          ]),
        });
        return Object.freeze({
          residualFindings: passed
            ? Object.freeze([])
            : Object.freeze([redirectMismatchFinding]),
          proof,
        });
      },
    });
  },
});
