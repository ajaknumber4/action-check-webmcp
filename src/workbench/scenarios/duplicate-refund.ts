import { duplicateRefundCase } from "../fixtures/duplicate-refund";
import type { AssuranceFinding, OutcomeProofView } from "../interface";
import type { AssuranceScenarioDefinition } from "./definition";
import { freezePlan } from "./definition";

export const DUPLICATE_REFUND_FINDING_ID = "finding-duplicate-refund-01";

export const duplicateRefundFinding: AssuranceFinding = Object.freeze({
  id: DUPLICATE_REFUND_FINDING_ID,
  category: "duplicate_refund",
  severity: "blocking",
  title: "A retry could create a second refund",
  summary: "The first response is lost after the provider accepts the refund.",
  failedInvariant: "One logical refund request may create at most one provider refund.",
  evidence: Object.freeze([Object.freeze({ label: "Refund attempts", expected: "2 calls, 1 effect", observed: "2 calls may create 2 effects" })]),
  smallestSafeCorrection: "Reuse one provider idempotency key for every retry of the logical refund.",
  confidence: "high",
  requiresHumanApproval: true,
  repairAvailable: true,
});

export const duplicateRefundScenario: AssuranceScenarioDefinition = Object.freeze({
  safeCase: duplicateRefundCase,
  finding: duplicateRefundFinding,
  patch: Object.freeze({
    patchId: "contract-refund-idempotency-01",
    field: "retry_policy" as const,
    fieldLabel: "Retry behavior",
    before: "Create a refund on every call",
    recommendedAfter: "Reuse the refund request ID",
    permittedValues: Object.freeze(["Create a refund on every call", "Reuse the refund request ID"]),
  }),
  plan(patch) {
    const deduplicates = patch.after === "Reuse the refund request ID";
    return freezePlan([
      { id: "read-before", label: "Read payment", status: "passed", detail: "Confirmed that the payment is captured." },
      { id: "first-call", label: "First call accepted", status: "passed", detail: "The provider records one refund." },
      { id: "lose-response", label: "Lose response", status: "passed", detail: "The accepted response is removed before it reaches the caller." },
      { id: "retry-call", label: "Retry same request", status: deduplicates ? "passed" : "failed", detail: deduplicates ? "The provider reuses the existing refund." : "The provider records a second refund." },
      { id: "read-after", label: "Read provider state", status: "passed", detail: "Read refunds from the synthetic provider ledger." },
      { id: "check-count", label: "Check refund count", status: deduplicates ? "passed" : "failed", detail: deduplicates ? "Exactly one refund exists." : "Two refunds exist." },
    ]);
  },
  createRuntime(patch) {
    const deduplicates = patch.after === "Reuse the refund request ID";
    let attempts = 0;
    let refunds = 0;
    let stateChecked = false;
    return Object.freeze({
      record(step) {
        if (step.id === "first-call") { attempts += 1; refunds += 1; }
        if (step.id === "retry-call") { attempts += 1; if (!deduplicates) refunds += 1; }
        if (step.id === "read-after") stateChecked = true;
      },
      evaluate() {
        const passed = attempts === 2 && refunds === 1 && stateChecked;
        const proof: OutcomeProofView = Object.freeze({
          status: passed ? "passed" : "failed",
          disposition: passed ? "unsafe_outcome_prevented" : "invariant_failed",
          businessOutcome: passed ? "achieved" : "unsafe",
          invariant: duplicateRefundFinding.failedInvariant,
          summary: passed ? "Two tool calls ran, but the provider recorded one refund." : "The retry created a second provider refund.",
          metrics: Object.freeze([
            Object.freeze({ label: "Tool calls", value: String(attempts) }),
            Object.freeze({ label: "Provider refunds", value: String(refunds) }),
            Object.freeze({ label: "Final state", value: refunds === 1 ? "Refunded once" : "Refunded twice" }),
          ]),
          evidence: Object.freeze([Object.freeze({ label: "Refund count", expected: "1", observed: String(refunds) })]),
        });
        return Object.freeze({ residualFindings: passed ? Object.freeze([]) : Object.freeze([duplicateRefundFinding]), proof });
      },
    });
  },
});
