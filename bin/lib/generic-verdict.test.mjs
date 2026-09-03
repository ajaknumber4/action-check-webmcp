import { describe, expect, it } from "vitest";

import { computeGenericVerdict } from "./generic-verdict.mjs";

const ok = (data = {}) => ({ ok: true, data });
const failed = (code = "SOME_ERROR") => ({ ok: false, error: { code } });

describe("computeGenericVerdict — retry mode (two identical calls)", () => {
  it("PASSes when two identical calls leave exactly one new effect (idempotent)", () => {
    const verdict = computeGenericVerdict({
      mode: "retry",
      calls: [ok(), ok()],
      before: { effectCount: 3 },
      after: { effectCount: 4 },
    });
    expect(verdict.status).toBe("PASS");
    expect(verdict.effectDelta).toBe(1);
  });

  it("FAILs with DUPLICATE_EFFECT when two identical calls create two effects", () => {
    const verdict = computeGenericVerdict({
      mode: "retry",
      calls: [ok(), ok()],
      before: { effectCount: 0 },
      after: { effectCount: 2 },
    });
    expect(verdict.status).toBe("FAIL");
    expect(verdict.code).toBe("DUPLICATE_EFFECT");
    expect(verdict.reason).toContain("2");
  });

  it("FAILs with NO_EFFECT when the tool claimed success but nothing changed", () => {
    const verdict = computeGenericVerdict({
      mode: "retry",
      calls: [ok(), ok()],
      before: { effectCount: 5 },
      after: { effectCount: 5 },
    });
    expect(verdict.status).toBe("FAIL");
    expect(verdict.code).toBe("NO_EFFECT");
  });

  it("PASSes when the second call is refused by the tool and only one effect exists", () => {
    const verdict = computeGenericVerdict({
      mode: "retry",
      calls: [ok(), failed("DUPLICATE_REQUEST")],
      before: { effectCount: 0 },
      after: { effectCount: 1 },
    });
    expect(verdict.status).toBe("PASS");
  });

  it("rejects input without two calls or without numeric before/after counts", () => {
    expect(computeGenericVerdict({ mode: "retry", calls: [ok()], before: { effectCount: 0 }, after: { effectCount: 1 } }).status).toBe("FAIL");
    expect(computeGenericVerdict({ mode: "retry", calls: [ok(), ok()], before: {}, after: { effectCount: 1 } }).code).toBe("HARNESS");
  });
});

describe("computeGenericVerdict — once mode (single call)", () => {
  it("PASSes when the tool reports success and one effect appeared", () => {
    const verdict = computeGenericVerdict({
      mode: "once",
      calls: [ok()],
      before: { effectCount: 1 },
      after: { effectCount: 2 },
    });
    expect(verdict.status).toBe("PASS");
  });

  it("FAILs with FALSE_SUCCESS when the tool reports success but no effect appeared", () => {
    const verdict = computeGenericVerdict({
      mode: "once",
      calls: [ok()],
      before: { effectCount: 1 },
      after: { effectCount: 1 },
    });
    expect(verdict.status).toBe("FAIL");
    expect(verdict.code).toBe("FALSE_SUCCESS");
  });

  it("FAILs with SILENT_EFFECT when the tool reports an error but the effect appeared anyway", () => {
    const verdict = computeGenericVerdict({
      mode: "once",
      calls: [failed()],
      before: { effectCount: 0 },
      after: { effectCount: 1 },
    });
    expect(verdict.status).toBe("FAIL");
    expect(verdict.code).toBe("SILENT_EFFECT");
  });

  it("PASSes when the tool reports an error and nothing changed (honest refusal)", () => {
    const verdict = computeGenericVerdict({
      mode: "once",
      calls: [failed("INVALID_INPUT")],
      before: { effectCount: 0 },
      after: { effectCount: 0 },
    });
    expect(verdict.status).toBe("PASS");
    expect(verdict.code).toBe("HONEST_REFUSAL");
  });
});

describe("computeGenericVerdict — tool result shapes", () => {
  it("treats a plain string result as a success claim (Chrome demos return strings)", () => {
    const verdict = computeGenericVerdict({
      mode: "once",
      calls: ["Reservation confirmed for 2 guests"],
      before: { effectCount: 0 },
      after: { effectCount: 1 },
    });
    expect(verdict.status).toBe("PASS");
  });

  it("treats a natural-language refusal string as a failure claim", () => {
    const verdict = computeGenericVerdict({
      mode: "once",
      calls: ["Topping 🍍 not found"],
      before: { effectCount: 0 },
      after: { effectCount: 0 },
    });
    expect(verdict.status).toBe("PASS");
    expect(verdict.code).toBe("HONEST_REFUSAL");
  });

  it("reads MCP-style content payloads and honours isError / success:false", () => {
    const refusal = computeGenericVerdict({ mode: "once", calls: [{ content: [{ type: "text", text: "Component not found" }] }], before: { effectCount: 0 }, after: { effectCount: 0 } });
    expect(refusal.code).toBe("HONEST_REFUSAL");
    const flagged = computeGenericVerdict({ mode: "once", calls: [{ content: [{ type: "text", text: "Done" }], isError: true }], before: { effectCount: 0 }, after: { effectCount: 0 } });
    expect(flagged.code).toBe("HONEST_REFUSAL");
    const explicit = computeGenericVerdict({ mode: "once", calls: [{ success: false, message: "Checkout already in progress" }], before: { effectCount: 1 }, after: { effectCount: 1 } });
    expect(explicit.code).toBe("HONEST_REFUSAL");
  });

  it("treats a thrown executeTool error as a failure claim", () => {
    const verdict = computeGenericVerdict({
      mode: "once",
      calls: [{ thrown: "Tool execution failed" }],
      before: { effectCount: 0 },
      after: { effectCount: 0 },
    });
    expect(verdict.status).toBe("PASS");
    expect(verdict.code).toBe("HONEST_REFUSAL");
  });
});
