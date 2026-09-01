import { describe, expect, it } from "vitest";

import {
  createAssuranceWorkbenchSession,
  DUPLICATE_EFFECT_CASE_ID,
  FALSE_SUCCESS_CASE_ID,
  type AssuranceWorkbenchSession,
} from "../src/workbench";

async function completeAssuranceJourney(session: AssuranceWorkbenchSession) {
  const diagnostics = await session.agent.execute({ kind: "run_diagnostics" });
  expect(diagnostics.ok).toBe(true);

  const finding = session.observe.getSnapshot().findings[0];
  expect(finding).toBeDefined();

  await session.agent.execute({
    kind: "stage_sandbox_fix",
    findingId: finding!.id,
  });
  const patch = session.observe.getSnapshot().patch;
  expect(patch).not.toBeNull();

  await session.human.execute({
    kind: "confirm_patch",
    expected: patch!.ref,
  });

  return session.agent.execute({ kind: "replay_flow" });
}

async function completeWithEditedGuardrail(
  session: AssuranceWorkbenchSession,
  after: string,
) {
  await session.agent.execute({ kind: "run_diagnostics" });
  const finding = session.observe.getSnapshot().findings[0]!;
  await session.agent.execute({
    kind: "stage_sandbox_fix",
    findingId: finding.id,
  });
  const staged = session.observe.getSnapshot().patch!;
  await session.human.execute({
    kind: "edit_patch",
    expected: staged.ref,
    after,
  });
  const edited = session.observe.getSnapshot().patch!;
  await session.human.execute({
    kind: "confirm_patch",
    expected: edited.ref,
  });
  return session.agent.execute({ kind: "replay_flow" });
}

describe("assurance scenarios", () => {
  it("switches scenarios through the human boundary and rejects unknown case IDs", async () => {
    const session = createAssuranceWorkbenchSession();

    const switched = await session.human.execute({
      kind: "reset",
      caseId: DUPLICATE_EFFECT_CASE_ID,
    });
    const duplicateView = session.observe.getSnapshot();

    expect(switched).toMatchObject({
      ok: true,
      phase: "case_loaded",
      data: { caseId: DUPLICATE_EFFECT_CASE_ID },
    });
    expect(duplicateView).toMatchObject({
      phase: "case_loaded",
      case: {
        id: DUPLICATE_EFFECT_CASE_ID,
        kind: "duplicate_effect",
      },
      findings: [],
      patch: null,
      proof: null,
      receipt: null,
    });

    const beforeUnknown = session.observe.getSnapshot();
    const unknown = await session.human.execute({
      kind: "reset",
      caseId: "not-a-real-scenario",
    });

    expect(unknown).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    expect(session.observe.getSnapshot()).toBe(beforeUnknown);
  });

  it("proves two attempts produced one committed effect and blocked the duplicate", async () => {
    const session = createAssuranceWorkbenchSession({
      caseId: DUPLICATE_EFFECT_CASE_ID,
    });

    const replay = await completeAssuranceJourney(session);
    const view = session.observe.getSnapshot();

    expect(replay).toMatchObject({
      ok: true,
      phase: "receipt_ready",
      data: {
        status: "succeeded",
        assuranceDisposition: "unsafe_outcome_prevented",
        businessOutcome: "achieved",
      },
    });
    expect(view.proof).toMatchObject({
      status: "passed",
      disposition: "unsafe_outcome_prevented",
      businessOutcome: "achieved",
      metrics: [
        { label: "Publish attempts", value: "2" },
        { label: "Posts created", value: "1" },
        { label: "Duplicates stopped", value: "1" },
      ],
    });
    expect(view.judgment).toMatchObject({
      id: "finding-duplicate-effect-01",
      title: "A retry created a second post",
    });
    expect(view.findings).toEqual([]);
    expect(view.receipt?.content).toContain("Publish attempts: 2");
    expect(view.receipt?.content).toContain("Posts created: 1");
    expect(view.receipt?.content).toContain("Duplicates stopped: 1");
    expect(view.receipt?.content).toContain("Observed outcome: safe effect achieved");
  });

  it("derives duplicate failure from two replayed commits and withholds a receipt", async () => {
    const session = createAssuranceWorkbenchSession({
      caseId: DUPLICATE_EFFECT_CASE_ID,
    });

    const replay = await completeWithEditedGuardrail(
      session,
      "Publish every retry",
    );
    const view = session.observe.getSnapshot();

    expect(replay).toMatchObject({
      ok: true,
      phase: "replay_failed",
      data: {
        status: "failed",
        assuranceDisposition: "invariant_failed",
        businessOutcome: "unsafe",
      },
    });
    expect(view.proof).toMatchObject({
      status: "failed",
      metrics: [
        { label: "Publish attempts", value: "2" },
        { label: "Posts created", value: "2" },
        { label: "Duplicates stopped", value: "0" },
      ],
    });
    expect(view.receipt).toBeNull();
  });

  it("distinguishes a completed tool call from a failed business post-condition", async () => {
    const session = createAssuranceWorkbenchSession({
      caseId: FALSE_SUCCESS_CASE_ID,
    });
    const immutableFacts = session.observe.getSnapshot().case.timeline;

    const replay = await completeAssuranceJourney(session);
    const view = session.observe.getSnapshot();

    expect(replay).toMatchObject({
      ok: true,
      phase: "receipt_ready",
      data: {
        status: "succeeded",
        assuranceDisposition: "false_success_detected",
        businessOutcome: "not_achieved",
      },
    });
    expect(view.proof).toMatchObject({
      status: "passed",
      disposition: "false_success_detected",
      businessOutcome: "not_achieved",
      metrics: [
        { label: "Tool said done", value: "Yes" },
        { label: "Post went live", value: "No" },
        { label: "False success caught", value: "Yes" },
      ],
    });
    expect(view.judgment).toMatchObject({
      id: "finding-false-success-01",
      title: "The tool said posted, but the post is still draft",
    });
    expect(view.findings).toEqual([]);
    expect(view.case.timeline).toBe(immutableFacts);
    expect(view.case.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Tool said done", status: "completed" }),
        expect.objectContaining({ label: "Post remained draft", status: "blocked" }),
      ]),
    );
    expect(view.receipt?.content).toContain("Tool said done: Yes");
    expect(view.receipt?.content).toContain("Post went live: No");
    expect(view.receipt?.content).toContain("False success caught: Yes");
    expect(view.receipt?.content).toContain(
      "Observed outcome: unchanged; false success caught",
    );
    expect(view.receipt?.content).not.toContain("Document published");
  });

  it("rejects an unverified success claim and withholds a receipt", async () => {
    const session = createAssuranceWorkbenchSession({
      caseId: FALSE_SUCCESS_CASE_ID,
    });

    const replay = await completeWithEditedGuardrail(
      session,
      "Trust the tool response",
    );
    const view = session.observe.getSnapshot();

    expect(replay).toMatchObject({
      ok: true,
      phase: "replay_failed",
      data: {
        status: "failed",
        assuranceDisposition: "invariant_failed",
        businessOutcome: "unsafe",
      },
    });
    expect(view.proof).toMatchObject({
      status: "failed",
      metrics: [
        { label: "Tool said done", value: "Yes" },
        { label: "Post went live", value: "No" },
        { label: "False success caught", value: "No" },
      ],
    });
    expect(view.receipt).toBeNull();
  });
});
