import type { AssuranceFinding, PatchView, SafeAssuranceCase } from "../interface";
import { getScenarioDefinition } from "../scenarios/registry";
import { createPatchRef } from "./patch-versioning";

export const PERMITTED_SYNTHETIC_REDIRECT_URIS = Object.freeze([
  "https://demo.example.com/oauth/callback",
  "https://demo.example.com/oauth/callback/",
] as const);

export function stageClosedAssuranceGuardrail(input: {
  safeCase: SafeAssuranceCase;
  finding: AssuranceFinding;
  sessionEpoch: number;
  patchVersion: number;
}): PatchView | null {
  const definition = getScenarioDefinition(input.safeCase.id);
  if (
    definition === undefined ||
    definition.finding.id !== input.finding.id ||
    !input.finding.repairAvailable
  ) {
    return null;
  }

  const identity = {
    caseId: input.safeCase.id,
    sessionEpoch: input.sessionEpoch,
    patchId: definition.patch.patchId,
    version: input.patchVersion,
    field: definition.patch.field,
    before: definition.patch.before,
    after: definition.patch.recommendedAfter,
  };

  return Object.freeze({
    ref: createPatchRef(identity),
    findingId: input.finding.id,
    field: identity.field,
    fieldLabel: definition.patch.fieldLabel,
    before: identity.before,
    after: identity.after,
    approvalStatus: "pending" as const,
  });
}

export function editPatch(
  patch: PatchView,
  after: string,
  patchVersion: number,
): PatchView {
  const identity = {
    caseId: patch.ref.caseId,
    sessionEpoch: patch.ref.sessionEpoch,
    patchId: patch.ref.patchId,
    version: patchVersion,
    field: patch.field,
    before: patch.before,
    after,
  };

  return Object.freeze({
    ...patch,
    ref: createPatchRef(identity),
    after,
    approvalStatus: "pending" as const,
  });
}

export function isSafePatchValue(caseId: string, value: string): boolean {
  return getScenarioDefinition(caseId)?.patch.permittedValues.includes(value) === true;
}

export const stageClosedRedirectRepair = stageClosedAssuranceGuardrail;
