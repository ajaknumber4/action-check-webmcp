import { describe, expect, it } from "vitest";

import {
  BOOKING_STATE_DRIFT_CASE_ID,
  CLOUD_FALSE_SUCCESS_CASE_ID,
  createAssuranceWorkbenchSession,
  DUPLICATE_REFUND_CASE_ID,
  SOCIAL_PUBLISH_CASE_ID,
  type AssuranceWorkbenchSession,
} from "../src/workbench";

async function runContract(session: AssuranceWorkbenchSession, weaken = false) {
  const diagnostics = await session.agent.execute({ kind: "run_diagnostics" });
  expect(diagnostics.ok).toBe(true);
  const finding = session.observe.getSnapshot().findings[0]!;

  const staged = await session.agent.execute({ kind: "stage_sandbox_fix", findingId: finding.id });
  expect(staged.ok).toBe(true);
  let patch = session.observe.getSnapshot().patch!;
  if (weaken) {
    const weakenedValue = staged.ok ? staged.data?.before : null;
    expect(typeof weakenedValue).toBe("string");
    const stagedRef = patch.ref;
    const edited = await session.human.execute({
      kind: "edit_patch",
      expected: stagedRef,
      after: weakenedValue as string,
    });
    expect(edited.ok).toBe(true);
    patch = session.observe.getSnapshot().patch!;
    expect(patch.ref.version).toBe(stagedRef.version + 1);
    expect(patch.ref.digest).not.toBe(stagedRef.digest);
  }
  const confirmed = await session.human.execute({ kind: "confirm_patch", expected: patch.ref });
  expect(confirmed.ok).toBe(true);
  const replayed = await session.agent.execute({ kind: "replay_flow" });
  expect(replayed.ok).toBe(true);
  return session.observe.getSnapshot();
}

const cases = [
  {
    caseId: BOOKING_STATE_DRIFT_CASE_ID,
    disposition: "unsafe_outcome_prevented",
    outcome: "not_achieved",
    metrics: ["Quote changed", "Bookings created", "Unsafe action stopped"],
  },
  {
    caseId: DUPLICATE_REFUND_CASE_ID,
    disposition: "unsafe_outcome_prevented",
    outcome: "achieved",
    metrics: ["Tool calls", "Provider refunds", "Final state"],
  },
  {
    caseId: CLOUD_FALSE_SUCCESS_CASE_ID,
    disposition: "false_success_detected",
    outcome: "not_achieved",
    metrics: ["Operation said done", "Service health", "False success rejected"],
  },
  {
    caseId: SOCIAL_PUBLISH_CASE_ID,
    disposition: "false_success_detected",
    outcome: "not_achieved",
    metrics: ["Tool said live", "Platform state", "False success rejected"],
  },
] as const;

describe("cross-industry effect scenarios", () => {
  for (const scenario of cases) {
    it(`${scenario.caseId} passes only with its full contract`, async () => {
      const passing = await runContract(createAssuranceWorkbenchSession({ caseId: scenario.caseId }));

      expect(passing.phase).toBe("receipt_ready");
      expect(passing.proof).toMatchObject({
        status: "passed",
        disposition: scenario.disposition,
        businessOutcome: scenario.outcome,
      });
      expect(passing.proof?.metrics.map((metric) => metric.label)).toEqual(scenario.metrics);
      expect(passing.receipt?.content).toContain("# Synthetic WebMCP effect test report");
      expect(passing.receipt?.content).toContain(`- WebMCP tool: ${passing.case.effectTest?.toolName}`);

      const failing = await runContract(
        createAssuranceWorkbenchSession({ caseId: scenario.caseId }),
        true,
      );
      expect(failing.phase).toBe("replay_failed");
      expect(failing.proof).toMatchObject({ status: "failed", disposition: "invariant_failed" });
      expect(failing.receipt).toBeNull();
      expect(failing.replay.steps.some((step) => step.status === "failed")).toBe(true);
    });
  }

  it("projects the bounded EffectContract through read_case", async () => {
    const session = createAssuranceWorkbenchSession({ caseId: DUPLICATE_REFUND_CASE_ID });
    const outcome = await session.agent.execute({ kind: "read_case" });

    expect(outcome).toMatchObject({
      ok: true,
      data: {
        webmcpTool: "issue_refund",
        effectContract: {
          effectId: "payment.refund",
          execute: "issue_refund",
          postcondition: "refund.count == 1",
        },
        injectedFault: { kind: "duplicate_delivery" },
      },
    });
  });
});
