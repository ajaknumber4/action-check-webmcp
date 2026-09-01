import { describe, expect, it } from "vitest";

import { createRefundComparisonSession } from "../src/refund-comparison";

describe("refund comparison session", () => {
  it("keeps observer snapshots stable until the session changes", async () => {
    const session = createRefundComparisonSession();
    const idle = session.observe.getSnapshot();

    expect(session.observe.getSnapshot()).toBe(idle);
    await session.agent.stageComparison();
    const staged = session.observe.getSnapshot();
    expect(staged).not.toBe(idle);
    expect(session.observe.getSnapshot()).toBe(staged);

    session.close();
    const closed = session.observe.getSnapshot();
    expect(closed).not.toBe(staged);
    expect(closed.phase).toBe("closed");
    expect(session.observe.getSnapshot()).toBe(closed);
  });

  it("blocks the synthetic refund target until a person approves the staged trial", async () => {
    const session = createRefundComparisonSession();

    const staged = await session.agent.stageComparison();
    const trial = session.observe.getSnapshot().trial;
    const denied = await session.target.issueRefund({
      lane: "broken",
      paymentId: "pay-204",
      amountMinor: 4200,
      currency: "USD",
      requestId: "refund-request-204",
    });

    expect(staged).toMatchObject({
      ok: true,
      action: "stage_refund_comparison",
      phase: "awaiting_approval",
    });
    expect(trial).toMatchObject({
      approvalStatus: "pending",
      paymentId: "pay-204",
      amountMinor: 4200,
      currency: "USD",
      requestId: "refund-request-204",
    });
    expect(denied).toMatchObject({
      ok: false,
      action: "issue_refund",
      error: { code: "HUMAN_APPROVAL_REQUIRED" },
    });
    expect(session.observe.getSnapshot().lanes.broken).toMatchObject({
      attempts: 0,
      providerRefunds: 0,
    });
  });

  it("proves the broken retry duplicates an effect while the protected retry reuses it", async () => {
    const session = createRefundComparisonSession();
    await session.agent.stageComparison();
    const trial = session.observe.getSnapshot().trial!;
    await session.human.approve(trial.ref);
    const approvedInput = {
      paymentId: trial.paymentId,
      amountMinor: trial.amountMinor,
      currency: trial.currency,
      requestId: trial.requestId,
    } as const;

    const brokenFirst = await session.target.issueRefund({
      ...approvedInput,
      lane: "broken",
    });
    const brokenRetry = await session.target.issueRefund({
      ...approvedInput,
      lane: "broken",
    });
    const protectedFirst = await session.target.issueRefund({
      ...approvedInput,
      lane: "protected",
    });
    const protectedRetry = await session.target.issueRefund({
      ...approvedInput,
      lane: "protected",
    });
    const proven = await session.agent.proveComparison();

    expect(brokenFirst).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_ACK_LOST_AFTER_COMMIT" },
    });
    expect(protectedFirst).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_ACK_LOST_AFTER_COMMIT" },
    });
    expect(brokenRetry).toMatchObject({
      ok: true,
      data: { claim: "new_refund_created" },
    });
    expect(protectedRetry).toMatchObject({
      ok: true,
      data: { claim: "existing_refund_reused" },
    });
    expect(proven).toMatchObject({
      ok: true,
      action: "prove_refund_comparison",
      phase: "proof_ready",
      data: {
        proof: {
          trialRef: trial.ref,
          requestId: trial.requestId,
          broken: {
            attempts: 2,
            providerRefunds: 2,
            effectIds: [
              "sim-refund-1-broken-1",
              "sim-refund-1-broken-2",
            ],
          },
          protected: {
            attempts: 2,
            providerRefunds: 1,
            effectIds: ["sim-refund-1-protected-1"],
          },
          evidenceSource: "one append-only synthetic provider ledger with separate lane records",
        },
      },
    });
    if (!proven.ok) throw new Error("Expected refund proof to succeed");
    const proof = proven.data?.proof as { receipt: string };
    expect(proof.receipt).toContain(`- Trial digest: ${trial.ref.digest}`);
    expect(proof.receipt).toContain(`- Request ID: ${trial.requestId}`);
    expect(proof.receipt).toContain("sim-refund-1-broken-2");
    expect(proof.receipt).toContain("sim-refund-1-protected-1");
    expect(session.observe.getSnapshot()).toMatchObject({
      phase: "proof_ready",
      lanes: {
        broken: { attempts: 2, providerRefunds: 2 },
        protected: { attempts: 2, providerRefunds: 1 },
      },
    });
  });

  it("invalidates an older approval reference when the agent stages a fresh trial", async () => {
    const session = createRefundComparisonSession();
    await session.agent.stageComparison();
    const firstRef = session.observe.getSnapshot().trial!.ref;
    await session.agent.stageComparison();

    expect(await session.human.approve(firstRef)).toMatchObject({
      ok: false,
      error: { code: "APPROVAL_STALE" },
    });
    expect(session.observe.getSnapshot()).toMatchObject({
      phase: "awaiting_approval",
      trial: { approvalStatus: "pending", ref: { epoch: 2 } },
    });
  });

  it("rejects changed inputs, premature proof, and a third delivery without changing evidence", async () => {
    const session = createRefundComparisonSession();
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

    expect(
      await session.target.issueRefund({ ...input, amountMinor: 4300 }),
    ).toMatchObject({ ok: false, error: { code: "INPUT_MISMATCH" } });
    expect(await session.agent.proveComparison()).toMatchObject({
      ok: false,
      error: { code: "PROOF_NOT_READY" },
    });
    await session.target.issueRefund(input);
    await session.target.issueRefund(input);
    const beforeThird = session.observe.getSnapshot();
    expect(await session.target.issueRefund(input)).toMatchObject({
      ok: false,
      error: { code: "CALL_LIMIT_REACHED" },
    });
    expect(session.observe.getSnapshot()).toBe(beforeThird);
    expect(beforeThird.lanes.broken).toMatchObject({
      attempts: 2,
      providerRefunds: 2,
    });
  });

  it("makes cancellation and closure fail closed", async () => {
    const session = createRefundComparisonSession();
    const cancelled = new AbortController();
    cancelled.abort();

    expect(
      await session.agent.stageComparison({ signal: cancelled.signal }),
    ).toMatchObject({
      ok: false,
      error: { code: "OPERATION_CANCELLED" },
    });
    expect(session.observe.getSnapshot().phase).toBe("idle");

    session.close();
    expect(await session.agent.stageComparison()).toMatchObject({
      ok: false,
      phase: "closed",
      error: { code: "SESSION_CLOSED" },
    });
  });
});
