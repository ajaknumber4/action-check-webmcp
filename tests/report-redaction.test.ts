import { describe, expect, it } from "vitest";

import { createOAuthWorkbenchSession, type OAuthWorkbenchSession } from "../src/workbench";

async function completeDefaultJourney(session: OAuthWorkbenchSession) {
  await session.agent.execute({ kind: "run_diagnostics" });
  await session.agent.execute({
    kind: "stage_sandbox_fix",
    findingId: "finding-redirect-uri-01",
  });
  const patch = session.observe.getSnapshot().patch!;
  await session.human.execute({ kind: "confirm_patch", expected: patch.ref });
  return session.agent.execute({ kind: "replay_flow" });
}

describe("safe bounded outputs", () => {
  it("materializes a deterministic bounded receipt with no secret-bearing fields", async () => {
    const first = createOAuthWorkbenchSession();
    const second = createOAuthWorkbenchSession();
    await completeDefaultJourney(first);
    await completeDefaultJourney(second);

    const firstReport = await first.agent.execute({ kind: "prepare_report" });
    const secondReport = await second.agent.execute({ kind: "prepare_report" });
    const firstView = first.observe.getSnapshot();
    const serialized = JSON.stringify({ firstReport, firstView });
    const forbiddenNames = [
      ["access", "Token"],
      ["refresh", "Token"],
      ["authorization", "Code"],
      ["code", "Verifier"],
      ["client", "Secret"],
      ["state", "Value"],
      ["session", "Cookie"],
    ].map((parts) => parts.join(""));

    expect(firstReport).toEqual(secondReport);
    expect(firstView.replay.steps).toEqual(second.observe.getSnapshot().replay.steps);
    expect(firstView.receipt).not.toBeNull();
    expect(firstView.receipt!.characterCount).toBe(firstView.receipt!.content.length);
    expect(firstView.receipt!.characterCount).toBeLessThanOrEqual(900);
    for (const name of forbiddenNames) {
      expect(serialized.toLowerCase()).not.toContain(name.toLowerCase());
    }
    expect(serialized).not.toMatch(/[?&](?:code|state|access_token|refresh_token|client_secret)=/i);
    expect(serialized).not.toMatch(/\bBearer\s+[A-Za-z0-9._~-]+/i);
  });

  it("rejects unsafe patch input before it can enter state or output", async () => {
    const session = createOAuthWorkbenchSession();
    await session.agent.execute({ kind: "run_diagnostics" });
    await session.agent.execute({
      kind: "stage_sandbox_fix",
      findingId: "finding-redirect-uri-01",
    });
    const before = session.observe.getSnapshot();
    const attemptedValue = "https://demo.example.com/oauth/callback?code=not-allowed";

    const result = await session.human.execute({
      kind: "edit_patch",
      expected: before.patch!.ref,
      after: attemptedValue,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PATCH_VALUE_INVALID" },
    });
    expect(session.observe.getSnapshot()).toBe(before);
    expect(JSON.stringify(result)).not.toContain(attemptedValue);
    expect(JSON.stringify(session.observe.getSnapshot())).not.toContain(attemptedValue);
  });

  it("fails closed when a tool result exceeds the configured output budget", async () => {
    const session = createOAuthWorkbenchSession({ outcomeCharacterBudget: 384 });
    const before = session.observe.getSnapshot();

    const result = await session.agent.execute({ kind: "read_case" });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "OUTPUT_BUDGET_EXCEEDED" },
    });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(384);
    expect(session.observe.getSnapshot()).toBe(before);
  });

  it("never exposes an injected scheduler exception", async () => {
    const session = createOAuthWorkbenchSession({
      replayScheduler: {
        async run() {
          throw new Error("unsafe-internal-detail");
        },
      },
    });
    await session.agent.execute({ kind: "run_diagnostics" });
    await session.agent.execute({
      kind: "stage_sandbox_fix",
      findingId: "finding-redirect-uri-01",
    });
    const patch = session.observe.getSnapshot().patch!;
    await session.human.execute({ kind: "confirm_patch", expected: patch.ref });

    const result = await session.agent.execute({ kind: "replay_flow" });

    expect(result).toMatchObject({
      ok: false,
      phase: "approved",
      error: { code: "INTERNAL_FAILURE" },
    });
    expect(JSON.stringify(result)).not.toContain("unsafe-internal-detail");
  });
});
