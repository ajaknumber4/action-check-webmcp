import type {
  PatchView,
  ReplayStepView,
  SafeAssuranceCase,
} from "../interface";
import type { PlannedReplayStep } from "../adapters/replay-scheduler";
import type { ScenarioReplayRuntime } from "../scenarios/definition";
import { getScenarioDefinition } from "../scenarios/registry";

export type ReplayPreparation = Readonly<{
  replayedCase: SafeAssuranceCase;
  pendingSteps: readonly ReplayStepView[];
  plan: readonly PlannedReplayStep[];
  runtime: ScenarioReplayRuntime;
}>;

export function prepareReplay(
  safeCase: SafeAssuranceCase,
  patch: PatchView,
): ReplayPreparation {
  const definition = getScenarioDefinition(safeCase.id);
  if (definition === undefined || patch.ref.caseId !== safeCase.id) {
    throw new Error("Unknown assurance scenario.");
  }
  const plan = definition.plan(patch);

  const pendingSteps: readonly ReplayStepView[] = Object.freeze(
    plan.map((step) =>
      Object.freeze({
        ...step,
        status: "pending" as const,
      }),
    ),
  );

  return Object.freeze({
    replayedCase: safeCase,
    pendingSteps,
    plan,
    runtime: definition.createRuntime(patch),
  });
}
