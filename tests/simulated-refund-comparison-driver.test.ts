import { describe, expect, it } from "vitest";

import { createRefundComparisonSession } from "../src/refund-comparison";
import {
  createSimulatedRefundComparisonRunner,
  SIMULATED_REFUND_STEP_ORDER,
  type SimulatedRefundRunState,
} from "../src/adapters/simulated-agent/run-simulated-refund-comparison";

/** Waits until `predicate(runner.getState())` is true, driven by its own
 *  subscription rather than polling, so it resolves the instant the state
 *  the test cares about lands. */
function waitForRunnerState(
  runner: ReturnType<typeof createSimulatedRefundComparisonRunner>,
  predicate: (state: SimulatedRefundRunState) => boolean,
): Promise<SimulatedRefundRunState> {
  return new Promise((resolve) => {
    const current = runner.getState();
    if (predicate(current)) {
      resolve(current);
      return;
    }
    const unsubscribe = runner.subscribe((state) => {
      if (predicate(state)) {
        unsubscribe();
        resolve(state);
      }
    });
  });
}

describe("simulated refund comparison driver", () => {
  it("runs the documented steps in order, waits for a real approval, and reaches 2-vs-1", async () => {
    const session = createRefundComparisonSession();
    const runner = createSimulatedRefundComparisonRunner(session);
    const statusesSeen: SimulatedRefundRunState["status"][] = [runner.getState().status];
    runner.subscribe((state) => {
      if (statusesSeen.at(-1) !== state.status) statusesSeen.push(state.status);
    });

    const runPromise = runner.run();

    // The driver must stop and wait — it never calls session.human.approve
    // itself. This is the "real click" stand-in: the test approves the
    // exact staged trial through the same session.human.approve the page's
    // Approve button calls.
    await waitForRunnerState(runner, (state) => state.status === "awaiting_human_approval");
    expect(session.observe.getSnapshot().phase).toBe("awaiting_approval");
    const stagedTrial = session.observe.getSnapshot().trial;
    expect(stagedTrial).not.toBeNull();
    const approval = await session.human.approve(stagedTrial!.ref);
    expect(approval.ok).toBe(true);

    await runPromise;

    const finalState = runner.getState();
    expect(finalState.status).toBe("complete");
    expect(finalState.error).toBe("");

    // Step ordering: every documented step ran, in the documented order,
    // and each one settled "ok".
    expect(finalState.steps.map((step) => step.id)).toEqual([...SIMULATED_REFUND_STEP_ORDER]);
    for (const step of finalState.steps) {
      expect(step.status, `step ${step.id} should have completed ok`).toBe("ok");
    }

    // The 2-vs-1 outcome, read from the observed ledgers exactly like the
    // native WebMCP path reads them — not asserted from tool responses.
    const view = session.observe.getSnapshot();
    expect(view.phase).toBe("proof_ready");
    expect(view.lanes.broken).toMatchObject({ attempts: 2, providerRefunds: 2 });
    expect(view.lanes.protected).toMatchObject({ attempts: 2, providerRefunds: 1 });
    expect(view.proof).toMatchObject({
      status: "passed",
      broken: { attempts: 2, providerRefunds: 2 },
      protected: { attempts: 2, providerRefunds: 1 },
    });

    // Badge-ownership state: the runner recorded which trial epoch it
    // staged, and that epoch matches the trial the final proof is bound to.
    expect(finalState.ownedEpoch).not.toBeNull();
    expect(finalState.ownedEpoch).toBe(view.trial?.ref.epoch);

    expect(statusesSeen).toEqual([
      "idle",
      "running",
      "awaiting_human_approval",
      "running",
      "complete",
    ]);
  });

  it("stops owning the trial once a later stage call replaces it", async () => {
    const session = createRefundComparisonSession();
    const runner = createSimulatedRefundComparisonRunner(session);

    const runPromise = runner.run();
    await waitForRunnerState(runner, (state) => state.status === "awaiting_human_approval");
    const firstTrial = session.observe.getSnapshot().trial!;
    await session.human.approve(firstTrial.ref);
    await runPromise;

    const ownedEpoch = runner.getState().ownedEpoch;
    expect(ownedEpoch).toBe(firstTrial.ref.epoch);

    // A later call on the SAME session — as a native WebMCP agent would
    // make — starts a fresh trial with a new epoch.
    const restaged = await session.agent.stageComparison();
    expect(restaged.ok).toBe(true);
    const newTrial = session.observe.getSnapshot().trial!;
    expect(newTrial.ref.epoch).not.toBe(ownedEpoch);

    // A caller computing "is this run still the one shown on the page"
    // (view.trial.ref.epoch === runner.getState().ownedEpoch) now correctly
    // reads false — the simulated badge must go away.
    expect(runner.getState().ownedEpoch).toBe(ownedEpoch);
    expect(session.observe.getSnapshot().trial?.ref.epoch).not.toBe(
      runner.getState().ownedEpoch,
    );
  });

  it("ignores a second run() call while one is already in flight", async () => {
    const session = createRefundComparisonSession();
    const runner = createSimulatedRefundComparisonRunner(session);

    const first = runner.run();
    const second = runner.run();
    await waitForRunnerState(runner, (state) => state.status === "awaiting_human_approval");

    // Only one "stage" invocation happened: the trial is still at epoch 1.
    expect(session.observe.getSnapshot().trial?.ref.epoch).toBe(1);

    const trial = session.observe.getSnapshot().trial!;
    await session.human.approve(trial.ref);
    await Promise.all([first, second]);

    expect(runner.getState().status).toBe("complete");
    expect(session.observe.getSnapshot().proof).toMatchObject({ status: "passed" });
  });

  it("surfaces a failed stage call as an error step without waiting for approval", async () => {
    const session = createRefundComparisonSession();
    session.close(); // Every subsequent call now fails with SESSION_CLOSED.
    const runner = createSimulatedRefundComparisonRunner(session);

    await runner.run();

    const state = runner.getState();
    expect(state.status).toBe("error");
    expect(state.error).not.toBe("");
    expect(state.steps.find((step) => step.id === "stage")?.status).toBe("error");
    expect(state.steps.find((step) => step.id === "await_approval")?.status).toBe("pending");
  });
});
