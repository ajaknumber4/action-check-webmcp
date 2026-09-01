import { describe, expect, it } from "vitest";

import {
  DuplicateRefundComparisonRegistrationError,
  REFUND_COMPARISON_TOOL_NAMES,
  registerRefundComparisonTools,
} from "../src/adapters/webmcp/register-refund-comparison-tools";
import { createRefundComparisonSession } from "../src/refund-comparison";
import { InMemoryModelContext } from "../src/testing/in-memory-model-context";

describe("refund comparison WebMCP surface", () => {
  it("reuses the active registration for the same refund session", async () => {
    const session = createRefundComparisonSession();
    const modelContext = new InMemoryModelContext();
    const registration = registerRefundComparisonTools(session, modelContext);
    await registration.ready;

    const duplicate = registerRefundComparisonTools(session, modelContext);

    expect(duplicate).toBe(registration);
    expect(modelContext.registrationAttempts).toHaveLength(3);
    expect(modelContext.listTools().map((tool) => tool.name)).toEqual(
      REFUND_COMPARISON_TOOL_NAMES,
    );
  });

  it("rejects a different refund session without disturbing active tools", async () => {
    const activeSession = createRefundComparisonSession();
    const conflictingSession = createRefundComparisonSession();
    const modelContext = new InMemoryModelContext();
    const registration = registerRefundComparisonTools(
      activeSession,
      modelContext,
    );
    await registration.ready;

    expect(() =>
      registerRefundComparisonTools(conflictingSession, modelContext),
    ).toThrow(DuplicateRefundComparisonRegistrationError);
    expect(modelContext.registrationAttempts).toHaveLength(3);
    expect(modelContext.listTools().map((tool) => tool.name)).toEqual(
      REFUND_COMPARISON_TOOL_NAMES,
    );

    expect(
      JSON.parse(await modelContext.invoke("stage_refund_comparison")),
    ).toMatchObject({ ok: true, phase: "awaiting_approval" });
    expect(activeSession.observe.getSnapshot().phase).toBe(
      "awaiting_approval",
    );
    expect(conflictingSession.observe.getSnapshot().phase).toBe("idle");
  });

  it("keeps reentrant disposal final during the last registration update", async () => {
    const session = createRefundComparisonSession();
    const modelContext = new InMemoryModelContext();
    const registration = registerRefundComparisonTools(session, modelContext);
    registration.subscribe((status) => {
      if (
        status.state === "registering" &&
        status.registeredToolCount === 3
      ) {
        registration.dispose();
      }
    });

    await expect(registration.ready).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(registration.getStatus()).toEqual({
      state: "disposed",
      registeredToolCount: 0,
      totalToolCount: 3,
    });
    expect(modelContext.listTools()).toEqual([]);
  });

  it("isolates a subscriber that throws during its initial status update", async () => {
    const session = createRefundComparisonSession();
    const modelContext = new InMemoryModelContext();
    const registration = registerRefundComparisonTools(session, modelContext);

    expect(() =>
      registration.subscribe(() => {
        throw new Error("presentation failed");
      }),
    ).not.toThrow();

    await expect(registration.ready).resolves.toBeUndefined();
    expect(registration.getStatus()).toEqual({
      state: "ready",
      registeredToolCount: 3,
      totalToolCount: 3,
    });
    expect(modelContext.listTools()).toHaveLength(3);
  });

  it("cleans partial tools and permits replacement after registration failure", async () => {
    const failedSession = createRefundComparisonSession();
    const replacementSession = createRefundComparisonSession();
    const modelContext = new InMemoryModelContext();
    modelContext.failRegistration(
      "issue_refund",
      new Error("synthetic registration failure"),
    );

    const failed = registerRefundComparisonTools(failedSession, modelContext);
    await expect(failed.ready).rejects.toThrow(
      "synthetic registration failure",
    );
    expect(failed.getStatus()).toMatchObject({
      state: "failed",
      registeredToolCount: 0,
    });
    expect(modelContext.listTools()).toEqual([]);

    const replacement = registerRefundComparisonTools(
      replacementSession,
      modelContext,
    );
    await expect(replacement.ready).resolves.toBeUndefined();
    expect(replacement.getStatus()).toEqual({
      state: "ready",
      registeredToolCount: 3,
      totalToolCount: 3,
    });
    expect(modelContext.listTools().map((tool) => tool.name)).toEqual(
      REFUND_COMPARISON_TOOL_NAMES,
    );
  });

  it("registers a real issue_refund target and blocks it before visible approval", async () => {
    const session = createRefundComparisonSession();
    const modelContext = new InMemoryModelContext();
    const registration = registerRefundComparisonTools(session, modelContext);
    await registration.ready;

    expect(modelContext.listTools().map((tool) => tool.name)).toEqual(
      REFUND_COMPARISON_TOOL_NAMES,
    );
    expect(modelContext.getTool("issue_refund")?.annotations).toEqual({
      readOnlyHint: false,
      untrustedContentHint: false,
    });
    expect(modelContext.getTool("prove_refund_comparison")?.annotations).toEqual({
      readOnlyHint: false,
      untrustedContentHint: false,
    });

    const staged = JSON.parse(
      await modelContext.invoke("stage_refund_comparison"),
    ) as { ok: boolean; phase: string };
    const denied = JSON.parse(
      await modelContext.invoke("issue_refund", {
        lane: "broken",
        paymentId: "pay-204",
        amountMinor: 4200,
        currency: "USD",
        requestId: "refund-request-204",
      }),
    ) as { ok: boolean; error: { code: string } };

    expect(staged).toMatchObject({ ok: true, phase: "awaiting_approval" });
    expect(denied).toMatchObject({
      ok: false,
      error: { code: "HUMAN_APPROVAL_REQUIRED" },
    });
    expect(session.observe.getSnapshot().lanes.broken.providerRefunds).toBe(0);
  });

  it("completes the agent to human to target to proof journey through WebMCP", async () => {
    const session = createRefundComparisonSession();
    const modelContext = new InMemoryModelContext();
    const registration = registerRefundComparisonTools(session, modelContext);
    await registration.ready;

    await modelContext.invoke("stage_refund_comparison");
    await session.human.approve(session.observe.getSnapshot().trial!.ref);
    const approvedInput = {
      paymentId: "pay-204",
      amountMinor: 4200,
      currency: "USD",
      requestId: "refund-request-204",
    } as const;

    for (const lane of ["broken", "protected"] as const) {
      const first = JSON.parse(
        await modelContext.invoke("issue_refund", { ...approvedInput, lane }),
      ) as { ok: boolean; error: { code: string } };
      const retry = JSON.parse(
        await modelContext.invoke("issue_refund", { ...approvedInput, lane }),
      ) as { ok: boolean; data: { claim: string } };
      expect(first).toMatchObject({
        ok: false,
        error: { code: "PROVIDER_ACK_LOST_AFTER_COMMIT" },
      });
      expect(retry.ok).toBe(true);
    }

    const proven = JSON.parse(
      await modelContext.invoke("prove_refund_comparison"),
    ) as {
      ok: boolean;
      data: {
        proof: {
          broken: { providerRefunds: number };
          protected: { providerRefunds: number };
        };
      };
    };

    expect(proven).toMatchObject({
      ok: true,
      data: {
        proof: {
          broken: { providerRefunds: 2 },
          protected: { providerRefunds: 1 },
        },
      },
    });

    registration.dispose();
    expect(modelContext.listTools()).toEqual([]);
  });

  it("rejects extra or malformed WebMCP arguments before they reach the target", async () => {
    const session = createRefundComparisonSession();
    const modelContext = new InMemoryModelContext();
    const registration = registerRefundComparisonTools(session, modelContext);
    await registration.ready;

    const staged = JSON.parse(
      await modelContext.invoke("stage_refund_comparison", { extra: true }),
    ) as { ok: boolean; error: { code: string } };
    const malformed = JSON.parse(
      await modelContext.invoke("issue_refund", {
        lane: "broken",
        paymentId: "real-payment-id",
        amountMinor: -1,
        currency: "usd",
        requestId: "not-bound",
      }),
    ) as { ok: boolean; error: { code: string } };

    expect(staged).toMatchObject({
      ok: false,
      error: { code: "INPUT_MISMATCH" },
    });
    expect(malformed).toMatchObject({
      ok: false,
      error: { code: "INPUT_MISMATCH" },
    });
    expect(session.observe.getSnapshot()).toMatchObject({
      phase: "idle",
      trial: null,
      lanes: {
        broken: { attempts: 0, providerRefunds: 0 },
        protected: { attempts: 0, providerRefunds: 0 },
      },
    });
  });
});
