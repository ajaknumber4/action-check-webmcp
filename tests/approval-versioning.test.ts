import { describe, expect, it } from "vitest";

import { createOAuthWorkbenchSession, type OAuthWorkbenchSession } from "../src/workbench";

async function stageDefaultRepair(session: OAuthWorkbenchSession) {
  await session.agent.execute({ kind: "run_diagnostics" });
  await session.agent.execute({
    kind: "stage_sandbox_fix",
    findingId: "finding-redirect-uri-01",
  });
  return session.observe.getSnapshot().patch!;
}

describe("exact patch approval", () => {
  it("denies replay before a person confirms the current patch", async () => {
    const session = createOAuthWorkbenchSession();
    await stageDefaultRepair(session);

    const result = await session.agent.execute({ kind: "replay_flow" });

    expect(result).toMatchObject({
      ok: false,
      phase: "awaiting_human_approval",
      error: { code: "HUMAN_APPROVAL_REQUIRED" },
    });
    expect(session.observe.getSnapshot()).toMatchObject({
      phase: "awaiting_human_approval",
      replay: { status: "idle" },
      receipt: null,
    });
  });

  it("increments version and digest on every edit and rejects stale confirmation", async () => {
    const session = createOAuthWorkbenchSession();
    const firstPatch = await stageDefaultRepair(session);

    const edit = await session.human.execute({
      kind: "edit_patch",
      expected: firstPatch.ref,
      after: "https://demo.example.com/oauth/callback/",
    });
    const secondPatch = session.observe.getSnapshot().patch!;

    expect(edit).toMatchObject({ ok: true, phase: "awaiting_human_approval" });
    expect(secondPatch.ref.version).toBe(2);
    expect(secondPatch.ref.digest).not.toBe(firstPatch.ref.digest);
    expect(secondPatch.approvalStatus).toBe("pending");

    const staleConfirmation = await session.human.execute({
      kind: "confirm_patch",
      expected: firstPatch.ref,
    });
    expect(staleConfirmation).toMatchObject({
      ok: false,
      error: { code: "PATCH_REF_STALE" },
    });
    expect(session.observe.getSnapshot().phase).toBe("awaiting_human_approval");

    const currentConfirmation = await session.human.execute({
      kind: "confirm_patch",
      expected: secondPatch.ref,
    });
    expect(currentConfirmation).toMatchObject({ ok: true, phase: "approved" });
  });

  it("invalidates approval when the approved value is edited", async () => {
    const session = createOAuthWorkbenchSession();
    const staged = await stageDefaultRepair(session);
    await session.human.execute({ kind: "confirm_patch", expected: staged.ref });
    const approved = session.observe.getSnapshot().patch!;

    const edit = await session.human.execute({
      kind: "edit_patch",
      expected: approved.ref,
      after: "https://demo.example.com/oauth/callback",
    });
    const edited = session.observe.getSnapshot().patch!;

    expect(edit).toMatchObject({ ok: true, phase: "awaiting_human_approval" });
    expect(edited.ref.version).toBe(approved.ref.version + 1);
    expect(edited.ref.digest).not.toBe(approved.ref.digest);
    expect(edited.approvalStatus).toBe("pending");

    const replay = await session.agent.execute({ kind: "replay_flow" });
    expect(replay).toMatchObject({
      ok: false,
      error: { code: "HUMAN_APPROVAL_REQUIRED" },
    });
  });

  it("rejects secret-like, personal, and open-ended redirect values", async () => {
    const forbiddenField = ["client", "secret"].join("_");
    const unsafeValues = [
      "https://demo.example.com/oauth/alice@example.com",
      "https://demo.example.com/oauth/sk_live_example",
      `https://demo.example.com/oauth/${forbiddenField}=example`,
      `https://demo.example.com/oauth/callback?${forbiddenField}=example`,
    ];

    for (const after of unsafeValues) {
      const session = createOAuthWorkbenchSession();
      const staged = await stageDefaultRepair(session);

      const edit = await session.human.execute({
        kind: "edit_patch",
        expected: staged.ref,
        after,
      });

      expect(edit).toMatchObject({
        ok: false,
        error: { code: "PATCH_VALUE_INVALID" },
      });
      expect(session.observe.getSnapshot().patch).toBe(staged);
    }
  });

  it("keeps a rejected patch visible but prevents replay", async () => {
    const session = createOAuthWorkbenchSession();
    const staged = await stageDefaultRepair(session);

    const rejected = await session.human.execute({
      kind: "reject_patch",
      expected: staged.ref,
    });

    expect(rejected).toMatchObject({ ok: true, phase: "rejected" });
    expect(session.observe.getSnapshot().patch).toMatchObject({ approvalStatus: "rejected" });
    expect(await session.agent.execute({ kind: "replay_flow" })).toMatchObject({
      ok: false,
      error: { code: "INVALID_PHASE" },
    });
  });

  it("never reuses a patch reference after rejection and restaging", async () => {
    const session = createOAuthWorkbenchSession();
    const first = await stageDefaultRepair(session);
    await session.human.execute({ kind: "reject_patch", expected: first.ref });

    await session.agent.execute({
      kind: "stage_sandbox_fix",
      findingId: "finding-redirect-uri-01",
    });
    const restaged = session.observe.getSnapshot().patch!;

    expect(restaged.ref.version).toBeGreaterThan(first.ref.version);
    expect(restaged.ref.digest).not.toBe(first.ref.digest);
    expect(
      await session.human.execute({
        kind: "confirm_patch",
        expected: first.ref,
      }),
    ).toMatchObject({ ok: false, error: { code: "PATCH_REF_STALE" } });
    expect(session.observe.getSnapshot()).toMatchObject({
      phase: "awaiting_human_approval",
      patch: { ref: restaged.ref, approvalStatus: "pending" },
    });
  });
});
