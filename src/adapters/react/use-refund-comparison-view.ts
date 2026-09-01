import { useCallback, useSyncExternalStore } from "react";

import type {
  RefundComparisonSession,
  RefundComparisonView,
} from "../../refund-comparison";

export function useRefundComparisonView(
  observer: RefundComparisonSession["observe"],
): RefundComparisonView {
  const subscribe = useCallback(
    (listener: () => void) => observer.subscribe(listener),
    [observer],
  );
  const getSnapshot = useCallback(() => observer.getSnapshot(), [observer]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
