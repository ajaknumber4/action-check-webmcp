import { useCallback, useSyncExternalStore } from "react";
import type {
  WorkbenchObserver,
  WorkbenchView,
} from "../../workbench/interface";

export function useWorkbenchView(observer: WorkbenchObserver): WorkbenchView {
  const subscribe = useCallback(
    (listener: () => void) => observer.subscribe(listener),
    [observer],
  );
  const getSnapshot = useCallback(() => observer.getSnapshot(), [observer]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
