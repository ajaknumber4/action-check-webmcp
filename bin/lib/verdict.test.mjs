import { describe, expect, it } from "vitest";

import { computeVerdict } from "./verdict.mjs";

function ackLostCall() {
  return { ok: false, error: { code: "PROVIDER_ACK_LOST_AFTER_COMMIT" } };
}

function brokenSecondCall() {
  return { ok: true, data: { claim: "new_refund_created" } };
}

function protectedSecondCall() {
  return { ok: true, data: { claim: "existing_refund_reused" } };
}

function validInput(overrides = {}) {
  return {
    lanes: {
      broken: {
        calls: [ackLostCall(), brokenSecondCall()],
        observed: { effectCount: 2, effectIds: ["a", "b"] },
      },
      protected: {
        calls: [ackLostCall(), protectedSecondCall()],
        observed: { effectCount: 1, effectIds: ["c"] },
      },
      ...overrides.lanes,
    },
  };
}

describe("computeVerdict", () => {
  it("PASSes when broken duplicated and protected deduplicated despite the ack-lost claim", () => {
    const verdict = computeVerdict(validInput());
    expect(verdict.status).toBe("PASS");
    expect(verdict.reason).toContain("effectCount");
  });

  it("FAILs when observe() echoes the tool's own claims instead of reading independently (negative case)", () => {
    // A broken observe() implementation that trusts the tool's claims would
    // report the broken lane's effectCount as the naive claimed-new-effects
    // count (1) instead of the true independently observed count (2). This
    // is exactly the failure mode the CLI exists to catch.
    const input = validInput();
    const tampered = {
      lanes: {
        ...input.lanes,
        broken: {
          ...input.lanes.broken,
          observed: { effectCount: 1, effectIds: ["a"] },
        },
      },
    };
    const verdict = computeVerdict(tampered);
    expect(verdict.status).toBe("FAIL");
    expect(verdict.reason).toContain("expected 2");
  });

  it("FAILs when the protected lane's retry was not deduplicated", () => {
    const input = validInput();
    const tampered = {
      lanes: {
        ...input.lanes,
        protected: {
          ...input.lanes.protected,
          observed: { effectCount: 2, effectIds: ["c", "d"] },
        },
      },
    };
    const verdict = computeVerdict(tampered);
    expect(verdict.status).toBe("FAIL");
    expect(verdict.reason).toContain("protected lane");
  });

  it("FAILs when lane data is missing", () => {
    const verdict = computeVerdict({ lanes: {} });
    expect(verdict.status).toBe("FAIL");
  });

  it("FAILs when the broken lane's first call did not claim ack-lost", () => {
    const input = validInput();
    const tampered = {
      lanes: {
        ...input.lanes,
        broken: {
          ...input.lanes.broken,
          calls: [{ ok: true, data: { claim: "new_refund_created" } }, brokenSecondCall()],
        },
      },
    };
    const verdict = computeVerdict(tampered);
    expect(verdict.status).toBe("FAIL");
    expect(verdict.reason).toContain("ack-lost");
  });

  it("FAILs when fewer than two calls were recorded for a lane", () => {
    const input = validInput();
    const tampered = {
      lanes: {
        ...input.lanes,
        broken: { ...input.lanes.broken, calls: [ackLostCall()] },
      },
    };
    const verdict = computeVerdict(tampered);
    expect(verdict.status).toBe("FAIL");
  });
});
