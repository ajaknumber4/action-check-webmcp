import type {
  OutcomeProofView,
  PatchView,
  ReceiptView,
  SafeAssuranceCase,
} from "../interface";

export const DEFAULT_REPORT_CHARACTER_BUDGET = 900;

export function createReceipt(input: {
  safeCase: SafeAssuranceCase;
  patch: PatchView;
  proof: OutcomeProofView;
  reportCharacterBudget: number;
}): ReceiptView | null {
  const test = input.safeCase.effectTest;
  const content = [
    "# Synthetic WebMCP effect test report",
    "",
    `- Scenario: ${input.safeCase.title}`,
    `- Scenario ID: ${input.safeCase.id}`,
    `- WebMCP tool: ${test?.toolName ?? "legacy_action"}`,
    `- Effect contract: ${test?.contract.effectId ?? input.patch.ref.patchId}`,
    `- Injected fault: ${test?.fault.label ?? input.safeCase.title}`,
    `- Postcondition: ${test?.contract.postcondition ?? input.proof.invariant}`,
    `- Check result: ${input.proof.status}`,
    `- Observed outcome: ${receiptOutcomeLabel(input.proof)}`,
    ...input.proof.metrics.map((metric) => `- ${metric.label}: ${metric.value}`),
    `- Deterministic run: e${input.patch.ref.sessionEpoch}-${input.patch.ref.digest}`,
    `- Data boundary: ${input.safeCase.safetyNotice}`,
    "- External changes: none",
  ].join("\n");

  if (content.length > input.reportCharacterBudget) {
    return null;
  }

  return Object.freeze({
    id: `receipt-${input.safeCase.id}-e${input.patch.ref.sessionEpoch}-${input.patch.ref.digest}`,
    format: "markdown" as const,
    content,
    characterCount: content.length,
  });
}

function receiptOutcomeLabel(proof: OutcomeProofView): string {
  if (proof.disposition === "false_success_detected") {
    return "unchanged; false success caught";
  }
  if (proof.disposition === "unsafe_outcome_prevented") {
    return proof.businessOutcome === "achieved"
      ? "safe effect achieved"
      : "unsafe action blocked";
  }
  if (proof.disposition === "intended_outcome_verified") {
    return "expected effect confirmed";
  }
  return "unsafe or unverified";
}
