import type { ReplayStepView } from "../interface";

export type PlannedReplayStep = Omit<ReplayStepView, "status"> &
  Readonly<{ status: "passed" | "failed" }>;

export interface ReplaySchedulerContext {
  readonly signal: AbortSignal;
  readonly onStep: (step: PlannedReplayStep) => void;
}

export interface ReplayScheduler {
  run(plan: readonly PlannedReplayStep[], context: ReplaySchedulerContext): Promise<void>;
}

export class ReplayCancelledError extends Error {
  constructor() {
    super("Replay cancelled");
    this.name = "ReplayCancelledError";
  }
}

export function throwIfReplayCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new ReplayCancelledError();
  }
}

export const immediateReplayScheduler: ReplayScheduler = Object.freeze({
  async run(plan: readonly PlannedReplayStep[], context: ReplaySchedulerContext) {
    for (const step of plan) {
      throwIfReplayCancelled(context.signal);
      context.onStep(step);
      await Promise.resolve();
    }
    throwIfReplayCancelled(context.signal);
  },
});
