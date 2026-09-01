import type {
  PlannedReplayStep,
  ReplayScheduler,
  ReplaySchedulerContext,
} from "./replay-scheduler";
import { ReplayCancelledError, throwIfReplayCancelled } from "./replay-scheduler";

export const DEFAULT_BROWSER_REPLAY_STEP_DELAY_MS = 160;

export type BrowserReplaySchedulerOptions = Readonly<{
  stepDelayMs?: number;
}>;

function normalizeDelay(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_BROWSER_REPLAY_STEP_DELAY_MS;
  }
  return Math.min(1_000, Math.max(0, Math.floor(value)));
}

function waitForStep(delayMs: number, signal: AbortSignal): Promise<void> {
  throwIfReplayCancelled(signal);

  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, delayMs);
    const cancel = () => {
      globalThis.clearTimeout(timer);
      reject(new ReplayCancelledError());
    };
    signal.addEventListener("abort", cancel, { once: true });
  });
}

export function createBrowserReplayScheduler(
  options: BrowserReplaySchedulerOptions = {},
): ReplayScheduler {
  const stepDelayMs = normalizeDelay(options.stepDelayMs);

  return Object.freeze({
    async run(plan: readonly PlannedReplayStep[], context: ReplaySchedulerContext) {
      for (const step of plan) {
        await waitForStep(stepDelayMs, context.signal);
        throwIfReplayCancelled(context.signal);
        context.onStep(step);
        throwIfReplayCancelled(context.signal);
      }
      throwIfReplayCancelled(context.signal);
    },
  });
}
