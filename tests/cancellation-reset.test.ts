import { describe, expect, it } from "vitest";

import {
  createBrowserReplayScheduler,
  createOAuthWorkbenchSession,
  type OAuthWorkbenchSession,
} from "../src/workbench";
import type { ReplayScheduler } from "../src/workbench/adapters/replay-scheduler";

async function approveDefaultRepair(session: OAuthWorkbenchSession) {
  await session.agent.execute({ kind: "run_diagnostics" });
  await session.agent.execute({
    kind: "stage_sandbox_fix",
    findingId: "finding-redirect-uri-01",
  });
  const patch = session.observe.getSnapshot().patch!;
  await session.human.execute({ kind: "confirm_patch", expected: patch.ref });
}

describe("cancellation, reset, and epoch protection", () => {
  it("cancels replay without losing an exact current approval", async () => {
    const session = createOAuthWorkbenchSession();
    await approveDefaultRepair(session);
    const controller = new AbortController();
    const unsubscribe = session.observe.subscribe(() => {
      if (session.observe.getSnapshot().phase === "replaying") {
        controller.abort();
      }
    });

    const result = await session.agent.execute(
      { kind: "replay_flow" },
      { signal: controller.signal },
    );
    unsubscribe();

    expect(result).toMatchObject({
      ok: false,
      phase: "approved",
      error: { code: "OPERATION_CANCELLED" },
    });
    expect(session.observe.getSnapshot()).toMatchObject({
      phase: "approved",
      replay: { status: "cancelled" },
      patch: { approvalStatus: "approved" },
      receipt: null,
    });

    expect(await session.agent.execute({ kind: "replay_flow" })).toMatchObject({
      ok: true,
      phase: "receipt_ready",
    });
  });

  it("lets reset preempt replay and ignores the late completion from the old epoch", async () => {
    const session = createOAuthWorkbenchSession();
    await approveDefaultRepair(session);
    let resetStarted = false;
    let resetResult: Promise<unknown> | undefined;
    const unsubscribe = session.observe.subscribe(() => {
      if (!resetStarted && session.observe.getSnapshot().phase === "replaying") {
        resetStarted = true;
        resetResult = session.human.execute({ kind: "reset" });
      }
    });

    const replayResult = await session.agent.execute({ kind: "replay_flow" });
    await resetResult;
    unsubscribe();

    expect(replayResult).toMatchObject({
      ok: false,
      phase: "case_loaded",
      error: { code: "OPERATION_CANCELLED" },
    });
    expect(session.observe.getSnapshot()).toMatchObject({
      sessionEpoch: 2,
      phase: "case_loaded",
      findings: [],
      patch: null,
      replay: { status: "idle", steps: [] },
      receipt: null,
    });
  });

  it("restores an identical initial projection apart from the required new epoch", async () => {
    const session = createOAuthWorkbenchSession();
    const initial = session.observe.getSnapshot();
    await approveDefaultRepair(session);
    await session.agent.execute({ kind: "replay_flow" });

    const reset = await session.human.execute({ kind: "reset" });
    const restored = session.observe.getSnapshot();

    expect(reset).toMatchObject({ ok: true, phase: "case_loaded" });
    expect({ ...restored, sessionEpoch: 1 }).toEqual(initial);
    expect(restored.sessionEpoch).toBe(2);
  });

  it("fails safely after close", async () => {
    const session = createOAuthWorkbenchSession();
    session.close();

    expect(session.observe.getSnapshot().sessionStatus).toBe("closed");
    expect(await session.agent.execute({ kind: "read_case" })).toMatchObject({
      ok: false,
      error: { code: "SESSION_CLOSED" },
    });
    expect(await session.human.execute({ kind: "reset" })).toMatchObject({
      ok: false,
      error: { code: "SESSION_CLOSED" },
    });
  });

  it("completes the same deterministic plan through the browser scheduler", async () => {
    const session = createOAuthWorkbenchSession({
      replayScheduler: createBrowserReplayScheduler({ stepDelayMs: 0 }),
    });
    await approveDefaultRepair(session);

    const result = await session.agent.execute({ kind: "replay_flow" });

    expect(result).toMatchObject({ ok: true, phase: "receipt_ready" });
    expect(session.observe.getSnapshot().replay.steps.map((step) => step.id)).toEqual([
      "capture-state",
      "bind-approval",
      "apply-guardrail",
      "verify-callback",
    ]);
  });

  it("does not expose transient two-commit phases to reentrant subscribers", async () => {
    const session = createOAuthWorkbenchSession();
    const observed: string[] = [];
    const unsubscribe = session.observe.subscribe(() => {
      const phase = session.observe.getSnapshot().phase;
      observed.push(phase);
      if (phase === "fix_staged" || phase === "replay_succeeded") {
        void session.human.execute({ kind: "reset" });
      }
    });

    await approveDefaultRepair(session);
    const replay = await session.agent.execute({ kind: "replay_flow" });
    unsubscribe();

    expect(observed).not.toContain("fix_staged");
    expect(observed).not.toContain("replay_succeeded");
    expect(replay).toMatchObject({ ok: true, phase: "receipt_ready" });
    expect(session.observe.getSnapshot()).toMatchObject({
      phase: "receipt_ready",
      receipt: { format: "markdown" },
    });
  });

  it.each([
    [
      "no steps",
      Object.freeze({
        async run() {},
      }) as ReplayScheduler,
    ],
    [
      "one step",
      Object.freeze({
        async run(
          plan: Parameters<ReplayScheduler["run"]>[0],
          context: Parameters<ReplayScheduler["run"]>[1],
        ) {
          const first = plan[0];
          if (first) context.onStep(first);
        },
      }) as ReplayScheduler,
    ],
    [
      "forged details",
      Object.freeze({
        async run(
          plan: Parameters<ReplayScheduler["run"]>[0],
          context: Parameters<ReplayScheduler["run"]>[1],
        ) {
          for (const step of plan) {
            context.onStep({ ...step, detail: "Forged scheduler detail." });
          }
        },
      }) as ReplayScheduler,
    ],
  ])("withholds proof when a scheduler emits %s", async (_label, scheduler) => {
    const session = createOAuthWorkbenchSession({ replayScheduler: scheduler });
    await approveDefaultRepair(session);

    const replay = await session.agent.execute({ kind: "replay_flow" });

    expect(replay).toMatchObject({
      ok: false,
      phase: "replay_failed",
      error: { code: "INTERNAL_FAILURE" },
    });
    expect(session.observe.getSnapshot()).toMatchObject({
      phase: "replay_failed",
      replay: { status: "failed" },
      receipt: null,
    });
  });

  it("treats cancellation on the final emitted step as cancellation", async () => {
    const caller = new AbortController();
    const abortOnFinalStep: ReplayScheduler = {
      async run(plan, context) {
        for (const [index, step] of plan.entries()) {
          context.onStep(step);
          if (index === plan.length - 1) {
            caller.abort();
          }
        }
      },
    };
    const session = createOAuthWorkbenchSession({
      replayScheduler: abortOnFinalStep,
    });
    await approveDefaultRepair(session);

    const replay = await session.agent.execute(
      { kind: "replay_flow" },
      { signal: caller.signal },
    );

    expect(replay).toMatchObject({
      ok: false,
      phase: "approved",
      error: { code: "OPERATION_CANCELLED" },
    });
    expect(session.observe.getSnapshot()).toMatchObject({
      phase: "approved",
      replay: { status: "cancelled" },
      receipt: null,
    });
  });
});
