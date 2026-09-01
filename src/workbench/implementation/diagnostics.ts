import type { AssuranceFinding, SafeAssuranceCase } from "../interface";
import { getScenarioDefinition } from "../scenarios/registry";
import { REDIRECT_MISMATCH_FINDING_ID } from "../scenarios/stale-approval";

export { REDIRECT_MISMATCH_FINDING_ID };

export function runAssuranceDiagnostics(
  safeCase: SafeAssuranceCase,
): readonly AssuranceFinding[] {
  const definition = getScenarioDefinition(safeCase.id);
  return definition === undefined
    ? Object.freeze([])
    : Object.freeze([definition.finding]);
}

export const runRedirectDiagnostics = runAssuranceDiagnostics;
