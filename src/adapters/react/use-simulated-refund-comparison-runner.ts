import { useCallback, useSyncExternalStore } from "react";

import type {
  SimulatedRefundComparisonRunner,
  SimulatedRefundRunState,
} from "../simulated-agent/run-simulated-refund-comparison";

export function useSimulatedRefundComparisonRunner(
  runner: SimulatedRefundComparisonRunner,
): SimulatedRefundRunState {
  const subscribe = useCallback(
    (listener: () => void) => runner.subscribe(listener),
    [runner],
  );
  const getSnapshot = useCallback(() => runner.getState(), [runner]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
