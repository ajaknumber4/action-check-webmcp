import type { PlannedReplayStep } from "../adapters/replay-scheduler";
import type {
  AssuranceFinding,
  OutcomeProofView,
  PatchField,
  PatchView,
  SafeAssuranceCase,
} from "../interface";

export type AssurancePatchRecipe = Readonly<{
  patchId: string;
  field: PatchField;
  fieldLabel: string;
  before: string;
  recommendedAfter: string;
  permittedValues: readonly string[];
}>;

export type ScenarioEvaluation = Readonly<{
  residualFindings: readonly AssuranceFinding[];
  proof: OutcomeProofView;
}>;

export type ScenarioReplayRuntime = Readonly<{
  record(step: PlannedReplayStep): void;
  evaluate(): ScenarioEvaluation;
}>;

export type AssuranceScenarioDefinition = Readonly<{
  safeCase: SafeAssuranceCase;
  finding: AssuranceFinding;
  patch: AssurancePatchRecipe;
  plan(patch: PatchView): readonly PlannedReplayStep[];
  createRuntime(patch: PatchView): ScenarioReplayRuntime;
}>;

export function freezePlan(
  steps: readonly PlannedReplayStep[],
): readonly PlannedReplayStep[] {
  return Object.freeze(steps.map((step) => Object.freeze({ ...step })));
}
