import { bookingStateDriftCase } from "../fixtures/booking-state-drift";
import type { AssuranceFinding, OutcomeProofView } from "../interface";
import type { AssuranceScenarioDefinition } from "./definition";
import { freezePlan } from "./definition";

export const BOOKING_STATE_DRIFT_FINDING_ID = "finding-booking-state-drift-01";

export const bookingStateDriftFinding: AssuranceFinding = Object.freeze({
  id: BOOKING_STATE_DRIFT_FINDING_ID,
  category: "state_drift",
  severity: "blocking",
  title: "The quote changed after approval",
  summary: "The approved version no longer matches the current price.",
  failedInvariant: "Do not create a booking from a quote that changed after approval.",
  evidence: Object.freeze([
    Object.freeze({ label: "Quote version", expected: "17", observed: "18" }),
  ]),
  smallestSafeCorrection: "Read the quote again and block execution when its approved fields changed.",
  confidence: "high",
  requiresHumanApproval: true,
  repairAvailable: true,
});

export const bookingStateDriftScenario: AssuranceScenarioDefinition = Object.freeze({
  safeCase: bookingStateDriftCase,
  finding: bookingStateDriftFinding,
  patch: Object.freeze({
    patchId: "contract-booking-approval-binding-01",
    field: "approval_binding" as const,
    fieldLabel: "Approval check",
    before: "Use the earlier approval",
    recommendedAfter: "Require the current quote version",
    permittedValues: Object.freeze([
      "Use the earlier approval",
      "Require the current quote version",
    ]),
  }),
  plan(patch) {
    const blocksOnDrift = patch.after === "Require the current quote version";
    return freezePlan([
      { id: "read-before", label: "Read current quote", status: "passed", detail: "Read quote version 18 before execution." },
      { id: "compare-approval", label: "Compare approval", status: blocksOnDrift ? "passed" : "failed", detail: blocksOnDrift ? "Detected that approved version 17 no longer matches." : "Ignored the changed quote version." },
      { id: "invoke-tool", label: "Attempt booking", status: blocksOnDrift ? "passed" : "failed", detail: blocksOnDrift ? "Stopped before creating a booking." : "Created a booking from stale approval." },
      { id: "read-after", label: "Count bookings", status: blocksOnDrift ? "passed" : "failed", detail: blocksOnDrift ? "The booking ledger contains zero new bookings." : "The booking ledger contains one unsafe booking." },
    ]);
  },
  createRuntime(patch) {
    const blocksOnDrift = patch.after === "Require the current quote version";
    let quoteRead = false;
    let driftDetected = false;
    let bookingsCreated = 0;
    let stateChecked = false;
    return Object.freeze({
      record(step) {
        if (step.id === "read-before") quoteRead = true;
        if (step.id === "compare-approval") driftDetected = blocksOnDrift;
        if (step.id === "invoke-tool" && !blocksOnDrift) bookingsCreated += 1;
        if (step.id === "read-after") stateChecked = true;
      },
      evaluate() {
        const passed = quoteRead && driftDetected && stateChecked && bookingsCreated === 0;
        const proof: OutcomeProofView = Object.freeze({
          status: passed ? "passed" : "failed",
          disposition: passed ? "unsafe_outcome_prevented" : "invariant_failed",
          businessOutcome: passed ? "not_achieved" : "unsafe",
          invariant: bookingStateDriftFinding.failedInvariant,
          summary: passed ? "The quote changed, so the tool stopped before creating a booking." : "The tool created a booking from an approval for an older quote.",
          metrics: Object.freeze([
            Object.freeze({ label: "Quote changed", value: "Yes" }),
            Object.freeze({ label: "Bookings created", value: String(bookingsCreated) }),
            Object.freeze({ label: "Unsafe action stopped", value: passed ? "Yes" : "No" }),
          ]),
          evidence: Object.freeze([
            Object.freeze({ label: "Booking count", expected: "0", observed: String(bookingsCreated) }),
          ]),
        });
        return Object.freeze({ residualFindings: passed ? Object.freeze([]) : Object.freeze([bookingStateDriftFinding]), proof });
      },
    });
  },
});
