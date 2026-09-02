import type {
  IssueRefundInput,
  RefundComparisonSession,
  RefundLane,
} from "../../refund-comparison";

/**
 * An alternate in-page client of the same RefundComparisonSession that
 * register-refund-comparison-tools.ts exposes to a native WebMCP client.
 * This driver calls the identical session.agent / session.target methods
 * directly — never through document.modelContext — so a visitor without a
 * WebMCP-capable browser can still see the real four-step proof. The human
 * approval step is deliberately NOT simulated here: the driver only waits
 * for session.observe to report an approved trial, which happens only when
 * a person clicks the real "Approve exact staging refund" button already
 * wired in RefundProofHero.
 */

export type SimulatedRefundStepId =
  | "stage"
  | "await_approval"
  | "issue_refund_broken_first"
  | "issue_refund_broken_retry"
  | "issue_refund_protected_first"
  | "issue_refund_protected_retry"
  | "prove";

export type SimulatedRefundStepStatus = "pending" | "running" | "ok" | "error";

export type SimulatedRefundStep = Readonly<{
  id: SimulatedRefundStepId;
  label: string;
  status: SimulatedRefundStepStatus;
  detail: string;
}>;

export type SimulatedRefundRunStatus =
  | "idle"
  | "running"
  | "awaiting_human_approval"
  | "complete"
  | "error";

export type SimulatedRefundRunState = Readonly<{
  status: SimulatedRefundRunStatus;
  steps: readonly SimulatedRefundStep[];
  /** The trial epoch this run staged, once known. Lets a caller decide
   *  whether the CURRENT view still reflects this simulated run, or a
   *  later native call has taken over the same session. */
  ownedEpoch: number | null;
  error: string;
}>;

export interface SimulatedRefundComparisonRunner {
  getState(): SimulatedRefundRunState;
  subscribe(listener: (state: SimulatedRefundRunState) => void): () => void;
  run(options?: Readonly<{ signal?: AbortSignal }>): Promise<void>;
}

export const SIMULATED_REFUND_STEP_ORDER: readonly SimulatedRefundStepId[] =
  Object.freeze([
    "stage",
    "await_approval",
    "issue_refund_broken_first",
    "issue_refund_broken_retry",
    "issue_refund_protected_first",
    "issue_refund_protected_retry",
    "prove",
  ]);

const STEP_LABEL: Readonly<Record<SimulatedRefundStepId, string>> =
  Object.freeze({
    stage: "stage_refund_comparison()",
    await_approval: "Wait for your real approval click",
    issue_refund_broken_first: 'issue_refund({ lane: "broken" }) — attempt 1',
    issue_refund_broken_retry: 'issue_refund({ lane: "broken" }) — retry, same request ID',
    issue_refund_protected_first: 'issue_refund({ lane: "protected" }) — attempt 1',
    issue_refund_protected_retry: 'issue_refund({ lane: "protected" }) — retry, same request ID',
    prove: "prove_refund_comparison()",
  });

function initialSteps(): readonly SimulatedRefundStep[] {
  return Object.freeze(
    SIMULATED_REFUND_STEP_ORDER.map((id) =>
      Object.freeze({ id, label: STEP_LABEL[id], status: "pending" as const, detail: "" }),
    ),
  );
}

export function createSimulatedRefundComparisonRunner(
  session: RefundComparisonSession,
): SimulatedRefundComparisonRunner {
  let state: SimulatedRefundRunState = Object.freeze({
    status: "idle",
    steps: initialSteps(),
    ownedEpoch: null,
    error: "",
  });
  const listeners = new Set<(state: SimulatedRefundRunState) => void>();

  function setState(patch: Partial<SimulatedRefundRunState>): void {
    state = Object.freeze({ ...state, ...patch });
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch {
        // A view subscriber cannot alter the run in progress.
      }
    }
  }

  function setStep(
    id: SimulatedRefundStepId,
    status: SimulatedRefundStepStatus,
    detail = "",
  ): void {
    setState({
      steps: state.steps.map((step) =>
        step.id === id ? Object.freeze({ ...step, status, detail }) : step,
      ),
    });
  }

  function waitForApproval(
    ownedEpoch: number,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        unsubscribe();
        signal?.removeEventListener("abort", onAbort);
        fn();
      };
      const check = (): void => {
        const snapshot = session.observe.getSnapshot();
        if (
          snapshot.phase === "closed" ||
          (snapshot.trial !== null && snapshot.trial.ref.epoch !== ownedEpoch)
        ) {
          finish(() =>
            reject(new Error("The staged trial changed before it was approved.")),
          );
          return;
        }
        if (
          snapshot.trial !== null &&
          snapshot.trial.ref.epoch === ownedEpoch &&
          snapshot.trial.approvalStatus === "approved"
        ) {
          finish(resolve);
        }
      };
      const onAbort = (): void => {
        finish(() => reject(new DOMException("Simulated run was aborted.", "AbortError")));
      };
      // Subscribe BEFORE the synchronous check below so an approval that
      // lands between the two calls is never missed.
      const unsubscribe = session.observe.subscribe(check);
      signal?.addEventListener("abort", onAbort);
      if (signal?.aborted) {
        onAbort();
        return;
      }
      check();
    });
  }

  async function issueLane(
    lane: RefundLane,
    args: Omit<IssueRefundInput, "lane">,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const firstId: SimulatedRefundStepId =
      lane === "broken" ? "issue_refund_broken_first" : "issue_refund_protected_first";
    const retryId: SimulatedRefundStepId =
      lane === "broken" ? "issue_refund_broken_retry" : "issue_refund_protected_retry";

    setStep(firstId, "running");
    const first = await session.target.issueRefund({ ...args, lane }, { signal });
    if (first.ok) {
      setStep(firstId, "ok", first.summary);
    } else if (first.error.code === "PROVIDER_ACK_LOST_AFTER_COMMIT") {
      setStep(firstId, "ok", "Expected: staging committed, acknowledgement dropped.");
    } else {
      setStep(firstId, "error", first.error.message);
      throw new Error(first.error.message);
    }

    setStep(retryId, "running");
    const retry = await session.target.issueRefund({ ...args, lane }, { signal });
    if (!retry.ok && retry.error.code !== "PROVIDER_ACK_LOST_AFTER_COMMIT") {
      setStep(retryId, "error", retry.error.message);
      throw new Error(retry.error.message);
    }
    setStep(
      retryId,
      "ok",
      retry.ok ? retry.summary : "Reconciled from the separate staging ledger.",
    );

    const laneSnapshot = session.observe.getSnapshot().lanes[lane];
    if (laneSnapshot.attempts !== 2 || laneSnapshot.recovery !== "ready") {
      throw new Error(
        `Lane "${lane}" did not reach two reconciled staging deliveries.`,
      );
    }
  }

  async function run(options: Readonly<{ signal?: AbortSignal }> = {}): Promise<void> {
    if (state.status === "running" || state.status === "awaiting_human_approval") {
      return;
    }
    const { signal } = options;
    setState({ status: "running", steps: initialSteps(), ownedEpoch: null, error: "" });

    try {
      setStep("stage", "running");
      const staged = await session.agent.stageComparison({ signal });
      if (!staged.ok) throw new Error(staged.error.message);
      const stagedTrial = session.observe.getSnapshot().trial;
      if (stagedTrial === null) {
        throw new Error("Staging did not produce a trial to approve.");
      }
      const ownedEpoch = stagedTrial.ref.epoch;
      setState({ ownedEpoch });
      setStep("stage", "ok", staged.summary);

      setState({ status: "awaiting_human_approval" });
      setStep("await_approval", "running");
      await waitForApproval(ownedEpoch, signal);
      setStep("await_approval", "ok", "Approved by a real click in the page.");
      setState({ status: "running" });

      const approvedTrial = session.observe.getSnapshot().trial;
      if (approvedTrial === null || approvedTrial.ref.epoch !== ownedEpoch) {
        throw new Error("The approved trial no longer matches the staged trial.");
      }
      const args: Omit<IssueRefundInput, "lane"> = {
        paymentId: approvedTrial.paymentId,
        amountMinor: approvedTrial.amountMinor,
        currency: approvedTrial.currency,
        requestId: approvedTrial.requestId,
      };

      await issueLane("broken", args, signal);
      await issueLane("protected", args, signal);

      setStep("prove", "running");
      const proved = await session.agent.proveComparison({ signal });
      if (!proved.ok) throw new Error(proved.error.message);
      setStep("prove", "ok", proved.summary);

      setState({ status: "complete" });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "The simulated agent run failed.";
      setState({
        status: "error",
        error: message,
        // Whichever step was in flight when the failure surfaced did not
        // finish — mark it, rather than leaving it stuck at "running".
        steps: state.steps.map((step) =>
          step.status === "running"
            ? Object.freeze({ ...step, status: "error" as const, detail: message })
            : step,
        ),
      });
    }
  }

  return Object.freeze({
    getState: () => state,
    subscribe(listener: (state: SimulatedRefundRunState) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    run,
  });
}
