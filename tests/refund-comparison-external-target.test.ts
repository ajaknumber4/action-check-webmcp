import { describe, expect, it } from "vitest";

import { createRefundComparisonSession } from "../src/refund-comparison";
import type {
  IssueRefundInput,
  RefundLane,
  RefundTrialRef,
} from "../src/refund-comparison";
import type {
  RefundEffectTarget,
  RefundTargetObservation,
  RefundTargetReset,
  RefundTargetRun,
} from "../src/refund-comparison/targets/refund-effect-target";

describe("refund comparison external effect contract", () => {
  it("fails the known-bad lane and passes the protected lane using observer evidence only", async () => {
    const target = new RecordingExternalTarget();
    const session = createRefundComparisonSession({ target });

    await session.agent.stageComparison();
    const trial = session.observe.getSnapshot().trial!;
    await session.human.approve(trial.ref);
    const exact = {
      paymentId: trial.paymentId,
      amountMinor: trial.amountMinor,
      currency: trial.currency,
      requestId: trial.requestId,
    } as const;

    for (const lane of ["broken", "protected"] as const) {
      await session.target.issueRefund({ ...exact, lane });
      await session.target.issueRefund({ ...exact, lane });
    }

    const outcome = await session.agent.proveComparison();

    expect(target.calls.map(({ operation }) => operation)).toEqual([
      "reset",
      "invoke",
      "observe",
      "invoke",
      "observe",
      "invoke",
      "observe",
      "invoke",
      "observe",
      "observe",
      "observe",
    ]);
    expect(outcome).toMatchObject({
      ok: true,
      data: {
        proof: {
          status: "passed",
          broken: {
            verdict: "failed_as_expected",
            providerRefunds: 2,
            effectIds: ["stage-broken-1", "stage-broken-2"],
          },
          protected: {
            verdict: "passed",
            providerRefunds: 1,
            effectIds: ["stage-protected-1"],
          },
          deploymentId: "refund-stage-test",
          evidenceSource:
            "external staging ledger read separately from the WebMCP response",
        },
      },
    });
    expect(target.invokeClaims).toEqual([
      "ack_lost",
      "created",
      "ack_lost",
      "reused",
    ]);
  });

  it("resets both external lanes to zero before approval and invalidates the previous run", async () => {
    const target = new RecordingExternalTarget();
    const session = createRefundComparisonSession({ target });

    await session.agent.stageComparison();
    const first = session.observe.getSnapshot().trial!;
    await session.human.approve(first.ref);
    await session.target.issueRefund({
      lane: "broken",
      paymentId: first.paymentId,
      amountMinor: first.amountMinor,
      currency: first.currency,
      requestId: first.requestId,
    });
    await session.agent.stageComparison();

    expect(target.cleanupCount).toBe(1);
    expect(target.resetCount).toBe(2);
    expect(session.observe.getSnapshot()).toMatchObject({
      phase: "awaiting_approval",
      trial: { ref: { epoch: 2 }, approvalStatus: "pending" },
      lanes: {
        broken: { attempts: 0, providerRefunds: 0 },
        protected: { attempts: 0, providerRefunds: 0 },
      },
    });
    expect(await session.human.approve(first.ref)).toMatchObject({
      ok: false,
      error: { code: "APPROVAL_STALE" },
    });
  });

  it("locks the lane when the first delivery creates no observed effect", async () => {
    const target = new RecordingExternalTarget({ delayProtectedEffectUntilSecond: true });
    const session = createRefundComparisonSession({ target });
    await session.agent.stageComparison();
    const trial = session.observe.getSnapshot().trial!;
    await session.human.approve(trial.ref);
    const exact = {
      paymentId: trial.paymentId,
      amountMinor: trial.amountMinor,
      currency: trial.currency,
      requestId: trial.requestId,
    } as const;
    expect(
      await session.target.issueRefund({ ...exact, lane: "protected" }),
    ).toMatchObject({
      ok: false,
      error: { code: "TARGET_OBSERVE_FAILED" },
    });
    expect(session.observe.getSnapshot().lanes.protected).toMatchObject({
      attempts: 1,
      providerRefunds: 0,
      recovery: "reset_required",
    });
    expect(
      await session.target.issueRefund({ ...exact, lane: "protected" }),
    ).toMatchObject({
      ok: false,
      error: { code: "TARGET_OBSERVE_FAILED" },
    });

    expect(await session.agent.proveComparison()).toMatchObject({
      ok: false,
      error: { code: "TARGET_OBSERVE_FAILED" },
    });
    expect(target.invokeCount("protected")).toBe(1);
    expect(session.observe.getSnapshot().proof).toBeNull();
  });

  it("locks proof when a protected retry replaces the first effect ID", async () => {
    const target = new RecordingExternalTarget({ replaceProtectedEffectOnSecond: true });
    const session = createRefundComparisonSession({ target });
    await session.agent.stageComparison();
    const trial = session.observe.getSnapshot().trial!;
    await session.human.approve(trial.ref);
    const input = {
      lane: "protected" as const,
      paymentId: trial.paymentId,
      amountMinor: trial.amountMinor,
      currency: trial.currency,
      requestId: trial.requestId,
    };

    await session.target.issueRefund(input);
    expect(await session.target.issueRefund(input)).toMatchObject({
      ok: false,
      error: { code: "TARGET_OBSERVE_FAILED" },
    });
    expect(session.observe.getSnapshot().lanes.protected).toMatchObject({
      attempts: 2,
      providerRefunds: 1,
      recovery: "reset_required",
    });
    expect(await session.agent.proveComparison()).toMatchObject({
      ok: false,
      error: { code: "TARGET_OBSERVE_FAILED" },
    });
    expect(session.observe.getSnapshot().proof).toBeNull();
  });

  it("blocks staging when reset cannot establish zero external baselines", async () => {
    const target = new RecordingExternalTarget({ dirtyBaseline: true });
    const session = createRefundComparisonSession({ target });

    expect(await session.agent.stageComparison()).toMatchObject({
      ok: false,
      error: { code: "TARGET_RESET_FAILED" },
    });
    expect(session.observe.getSnapshot()).toMatchObject({ phase: "idle", trial: null });
    expect(target.calls.filter(({ operation }) => operation === "invoke")).toHaveLength(0);
  });

  it("serializes concurrent same-lane calls so two deliveries cannot become three", async () => {
    const target = new RecordingExternalTarget();
    const session = createRefundComparisonSession({ target });
    await session.agent.stageComparison();
    const trial = session.observe.getSnapshot().trial!;
    await session.human.approve(trial.ref);
    const input = {
      lane: "broken" as const,
      paymentId: trial.paymentId,
      amountMinor: trial.amountMinor,
      currency: trial.currency,
      requestId: trial.requestId,
    };

    await Promise.all([
      session.target.issueRefund(input),
      session.target.issueRefund(input),
    ]);

    expect(session.observe.getSnapshot().lanes.broken).toMatchObject({
      attempts: 2,
      providerRefunds: 2,
    });
    expect(await session.target.issueRefund(input)).toMatchObject({
      ok: false,
      error: { code: "CALL_LIMIT_REACHED" },
    });
    expect(target.invokeCount("broken")).toBe(2);
  });

  it("reconciles a committed effect when the invoke response is lost", async () => {
    const target = new RecordingExternalTarget({ throwAfterFirstCommit: true });
    const session = createRefundComparisonSession({ target });
    await session.agent.stageComparison();
    const trial = session.observe.getSnapshot().trial!;
    await session.human.approve(trial.ref);
    const input = {
      lane: "broken" as const,
      paymentId: trial.paymentId,
      amountMinor: trial.amountMinor,
      currency: trial.currency,
      requestId: trial.requestId,
    };

    expect(await session.target.issueRefund(input)).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_ACK_LOST_AFTER_COMMIT" },
    });
    expect(session.observe.getSnapshot().lanes.broken).toMatchObject({
      attempts: 1,
      providerRefunds: 1,
      lastClaim: "provider_ack_lost",
    });

    await session.target.issueRefund(input);
    expect(session.observe.getSnapshot().lanes.broken).toMatchObject({
      attempts: 2,
      providerRefunds: 2,
    });
    expect(await session.target.issueRefund(input)).toMatchObject({
      ok: false,
      error: { code: "CALL_LIMIT_REACHED" },
    });
  });

  it("returns cancellation without consuming an attempt when abort happens before commit", async () => {
    const base = new RecordingExternalTarget();
    let markInvokeStarted!: () => void;
    const invokeStarted = new Promise<void>((resolve) => {
      markInvokeStarted = resolve;
    });
    const target: RefundEffectTarget = {
      reset: (input) => base.reset(input),
      invoke: (_run, _input, options) => {
        markInvokeStarted();
        return new Promise((_resolve, reject) => {
          const abort = () => reject(new DOMException("cancelled", "AbortError"));
          if (options?.signal?.aborted) abort();
          else options?.signal?.addEventListener("abort", abort, { once: true });
        });
      },
      observe: (run) => base.observe(run),
      cleanup: () => base.cleanup(),
    };
    const session = createRefundComparisonSession({ target });
    await session.agent.stageComparison();
    const trial = session.observe.getSnapshot().trial!;
    await session.human.approve(trial.ref);
    const controller = new AbortController();
    const pending = session.target.issueRefund(
      {
        lane: "broken",
        paymentId: trial.paymentId,
        amountMinor: trial.amountMinor,
        currency: trial.currency,
        requestId: trial.requestId,
      },
      { signal: controller.signal },
    );

    await invokeStarted;
    controller.abort();
    expect(await pending).toMatchObject({
      ok: false,
      error: { code: "OPERATION_CANCELLED" },
    });
    expect(session.observe.getSnapshot().lanes.broken).toMatchObject({
      attempts: 0,
      providerRefunds: 0,
      recovery: "ready",
    });
  });

  it("reconciles a committed effect when abort happens after commit", async () => {
    const base = new RecordingExternalTarget();
    let markCommitFinished!: () => void;
    const commitFinished = new Promise<void>((resolve) => {
      markCommitFinished = resolve;
    });
    const target: RefundEffectTarget = {
      reset: (input) => base.reset(input),
      invoke: async (run, input, options) => {
        await base.invoke(run, input);
        markCommitFinished();
        await new Promise<void>((_resolve, reject) => {
          const abort = () => reject(new DOMException("cancelled", "AbortError"));
          if (options?.signal?.aborted) abort();
          else options?.signal?.addEventListener("abort", abort, { once: true });
        });
        throw new Error("unreachable");
      },
      observe: (run) => base.observe(run),
      cleanup: () => base.cleanup(),
    };
    const session = createRefundComparisonSession({ target });
    await session.agent.stageComparison();
    const trial = session.observe.getSnapshot().trial!;
    await session.human.approve(trial.ref);
    const controller = new AbortController();
    const pending = session.target.issueRefund(
      {
        lane: "broken",
        paymentId: trial.paymentId,
        amountMinor: trial.amountMinor,
        currency: trial.currency,
        requestId: trial.requestId,
      },
      { signal: controller.signal },
    );

    await commitFinished;
    controller.abort();
    expect(await pending).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_ACK_LOST_AFTER_COMMIT" },
    });
    expect(session.observe.getSnapshot().lanes.broken).toMatchObject({
      attempts: 1,
      providerRefunds: 1,
      recovery: "ready",
    });
  });

  it("reconciles an invalid invoke claim before another mutation is allowed", async () => {
    const target = new RecordingExternalTarget({ mismatchedFirstClaim: true });
    const session = createRefundComparisonSession({ target });
    await session.agent.stageComparison();
    const trial = session.observe.getSnapshot().trial!;
    await session.human.approve(trial.ref);
    const input = {
      lane: "broken" as const,
      paymentId: trial.paymentId,
      amountMinor: trial.amountMinor,
      currency: trial.currency,
      requestId: trial.requestId,
    };

    expect(await session.target.issueRefund(input)).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_ACK_LOST_AFTER_COMMIT" },
    });
    expect(session.observe.getSnapshot().lanes.broken).toMatchObject({
      attempts: 1,
      providerRefunds: 1,
      lastClaim: "provider_ack_lost",
    });

    await session.target.issueRefund(input);
    expect(session.observe.getSnapshot().lanes.broken).toMatchObject({
      attempts: 2,
      providerRefunds: 2,
    });
    expect(await session.target.issueRefund(input)).toMatchObject({
      ok: false,
      error: { code: "CALL_LIMIT_REACHED" },
    });
    expect(target.invokeCount("broken")).toBe(2);
  });

  it("rejects proof when external evidence contains an untracked third invocation", async () => {
    const target = new RecordingExternalTarget();
    const session = createRefundComparisonSession({ target });
    await session.agent.stageComparison();
    const trial = session.observe.getSnapshot().trial!;
    await session.human.approve(trial.ref);
    const exact = {
      paymentId: trial.paymentId,
      amountMinor: trial.amountMinor,
      currency: trial.currency,
      requestId: trial.requestId,
    } as const;
    for (const lane of ["broken", "protected"] as const) {
      await session.target.issueRefund({ ...exact, lane });
      await session.target.issueRefund({ ...exact, lane });
    }
    target.injectHiddenInvocation("protected");

    expect(await session.agent.proveComparison()).toMatchObject({
      ok: false,
      error: { code: "TARGET_OBSERVE_FAILED" },
    });
    expect(session.observe.getSnapshot().proof).toBeNull();
  });
});

type TargetOptions = Readonly<{
  delayProtectedEffectUntilSecond?: boolean;
  dirtyBaseline?: boolean;
  mismatchedFirstClaim?: boolean;
  replaceProtectedEffectOnSecond?: boolean;
  throwAfterFirstCommit?: boolean;
}>;

class RecordingExternalTarget implements RefundEffectTarget {
  readonly calls: Array<Readonly<{ operation: "reset" | "invoke" | "observe"; lane?: RefundLane }>> = [];
  readonly invokeClaims: string[] = [];
  cleanupCount = 0;
  resetCount = 0;
  readonly #options: TargetOptions;
  readonly #effects: Record<RefundLane, string[]> = { broken: [], protected: [] };
  readonly #sequences: Record<RefundLane, number> = { broken: 0, protected: 0 };

  constructor(options: TargetOptions = {}) {
    this.#options = options;
  }

  async reset(input: {
    trialRef: RefundTrialRef;
    requestId: string;
  }): Promise<RefundTargetReset> {
    this.calls.push({ operation: "reset" });
    this.resetCount += 1;
    this.#effects.broken = this.#options.dirtyBaseline ? ["unexpected"] : [];
    this.#effects.protected = [];
    this.#sequences.broken = 0;
    this.#sequences.protected = 0;
    const runs = {
      broken: this.#run("broken", input.trialRef.digest),
      protected: this.#run("protected", input.trialRef.digest),
    } as const;
    return {
      attestation: {
        service: "action-check-refund-staging",
        environment: "staging",
        deploymentId: "refund-stage-test",
        capability: "refund-retry-effect-v1",
        store: "durable",
        attestationDigest: "attestation-test",
      },
      runs,
      baseline: {
        broken: this.#observation(runs.broken),
        protected: this.#observation(runs.protected),
      },
    };
  }

  async invoke(run: RefundTargetRun, input: IssueRefundInput) {
    this.calls.push({ operation: "invoke", lane: run.lane });
    this.#sequences[run.lane] += 1;
    const existing = this.#effects[run.lane][0];
    let claim: "created" | "reused" | "ack_lost";
    if (run.lane === "protected" && existing) {
      if (
        this.#options.replaceProtectedEffectOnSecond &&
        this.#sequences[run.lane] === 2
      ) {
        this.#effects[run.lane][0] = "stage-protected-replacement";
      }
      claim = "reused";
    } else {
      const suppressEffect =
        run.lane === "protected" &&
        this.#options.delayProtectedEffectUntilSecond &&
        this.#sequences[run.lane] === 1;
      if (!suppressEffect) {
        this.#effects[run.lane].push(`stage-${run.lane}-${this.#effects[run.lane].length + 1}`);
      }
      claim = this.#sequences[run.lane] === 1 ? "ack_lost" : "created";
    }
    this.invokeClaims.push(claim);
    if (this.#options.throwAfterFirstCommit && this.#sequences[run.lane] === 1) {
      throw new TypeError("simulated response loss after commit");
    }
    return {
      runId: run.runId,
      requestId:
        this.#options.mismatchedFirstClaim && this.#sequences[run.lane] === 1
          ? "wrong-request"
          : input.requestId,
      claim,
    } as const;
  }

  async observe(run: RefundTargetRun): Promise<RefundTargetObservation> {
    this.calls.push({ operation: "observe", lane: run.lane });
    return this.#observation(run);
  }

  async cleanup(): Promise<void> {
    this.cleanupCount += 1;
  }

  invokeCount(lane: RefundLane): number {
    return this.calls.filter(
      (call) => call.operation === "invoke" && call.lane === lane,
    ).length;
  }

  injectHiddenInvocation(lane: RefundLane): void {
    this.#sequences[lane] += 1;
  }

  #run(lane: RefundLane, trialDigest: string): RefundTargetRun {
    return {
      runId: `run-${this.resetCount}-${lane}`,
      lane,
      requestId: "refund-request-204",
      trialDigest,
      leaseExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      attestationDigest: "attestation-test",
    };
  }

  #observation(run: RefundTargetRun): RefundTargetObservation {
    return {
      runId: run.runId,
      lane: run.lane,
      sequence: this.#sequences[run.lane],
      effectCount: this.#effects[run.lane].length,
      effectIds: [...this.#effects[run.lane]],
      evidenceDigest: `evidence-${run.lane}-${this.#sequences[run.lane]}-${this.#effects[run.lane].length}`,
      observedAt: "2026-08-31T12:00:00.000Z",
      source: "external-refund-staging",
    };
  }
}
