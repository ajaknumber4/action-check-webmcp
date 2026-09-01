import { describe, expect, it } from "vitest";

import { createAssuranceWorkbenchSession } from "../src/workbench";

describe("assurance workbench session contract", () => {
  it("lets an agent read the safe default case without changing it", async () => {
    const session = createAssuranceWorkbenchSession();

    const result = await session.agent.execute({ kind: "read_case" });
    const view = session.observe.getSnapshot();

    expect(result).toMatchObject({
      ok: true,
      command: "read_case",
      phase: "case_loaded",
    });
    expect(view).toMatchObject({
      sessionEpoch: 1,
      phase: "case_loaded",
      case: {
        id: "oauth-demo-redirect-01",
        synthetic: true,
        registeredRedirectUri: "https://demo.example.com/oauth/callback",
        observedRedirectUri: "https://demo.example.com/oauth/callback/",
      },
      findings: [],
      patch: null,
      receipt: null,
    });
  });

  it("diagnoses, explains, guards, replays, and reports through the caller-first seam", async () => {
    const session = createAssuranceWorkbenchSession();

    const diagnostics = await session.agent.execute({ kind: "run_diagnostics" });
    expect(diagnostics).toMatchObject({
      ok: true,
      command: "run_diagnostics",
      phase: "diagnosed",
      data: {
        status: "blocked",
        findingIds: ["finding-redirect-uri-01"],
      },
    });
    expect(session.observe.getSnapshot().findings[0]).toMatchObject({
      id: "finding-redirect-uri-01",
      severity: "blocking",
      failedInvariant:
        "Use the exact callback value the person approved.",
    });

    const explanation = await session.agent.execute({
      kind: "explain_finding",
      findingId: "finding-redirect-uri-01",
    });
    expect(explanation).toMatchObject({
      ok: true,
      data: {
        evidence: [
          {
            expected: "https://demo.example.com/oauth/callback",
            observed: "https://demo.example.com/oauth/callback/",
          },
        ],
        humanActionRequired: true,
      },
    });

    const staged = await session.agent.execute({
      kind: "stage_sandbox_fix",
      findingId: "finding-redirect-uri-01",
    });
    const stagedView = session.observe.getSnapshot();
    expect(staged).toMatchObject({ ok: true, phase: "awaiting_human_approval" });
    expect(stagedView.patch).toMatchObject({
      field: "observed_redirect_uri",
      before: "https://demo.example.com/oauth/callback/",
      after: "https://demo.example.com/oauth/callback",
      approvalStatus: "pending",
      ref: { sessionEpoch: 1, patchId: "patch-redirect-uri-01", version: 1 },
    });
    expect(stagedView.allowedNextActions.agent).not.toContain("replay_flow");
    expect(stagedView.allowedNextActions.human).toContain("confirm_patch");

    const confirmed = await session.human.execute({
      kind: "confirm_patch",
      expected: stagedView.patch!.ref,
    });
    expect(confirmed).toMatchObject({ ok: true, phase: "approved" });

    const baselineCase = session.observe.getSnapshot().case;
    const replayed = await session.agent.execute({ kind: "replay_flow" });
    const replayedView = session.observe.getSnapshot();
    expect(replayed).toMatchObject({
      ok: true,
      command: "replay_flow",
      phase: "receipt_ready",
      data: { status: "succeeded" },
    });
    expect(replayedView).toMatchObject({
      phase: "receipt_ready",
      case: {
        observedRedirectUri: "https://demo.example.com/oauth/callback/",
      },
      findings: [],
      replay: { status: "succeeded" },
      proof: {
        status: "passed",
        disposition: "intended_outcome_verified",
        businessOutcome: "achieved",
        evidence: [
          {
            label: "Final callback",
            expected: "https://demo.example.com/oauth/callback",
            observed: "https://demo.example.com/oauth/callback",
          },
        ],
      },
    });
    expect(replayedView.case).toBe(baselineCase);
    expect(replayedView.replay.steps).toHaveLength(4);
    expect(replayedView.replay.steps.map((step) => step.label)).toEqual([
      "Read current setting",
      "Match approval",
      "Apply in demo",
      "Test connection",
    ]);
    expect(replayedView.replay.steps.every((step) => step.status === "passed")).toBe(true);
    expect(replayedView.receipt).not.toBeNull();

    const materializedReceipt = replayedView.receipt;
    const report = await session.agent.execute({ kind: "prepare_report" });
    expect(report).toMatchObject({
      ok: true,
      command: "prepare_report",
      phase: "receipt_ready",
      data: { format: "markdown" },
    });
    expect(session.observe.getSnapshot()).toBe(replayedView);
    expect(session.observe.getSnapshot().receipt).toBe(materializedReceipt);
  });
});
