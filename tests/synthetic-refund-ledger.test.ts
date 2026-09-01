import { describe, expect, it } from "vitest";

import { createSyntheticRefundLedger } from "../src/refund-comparison/implementation/synthetic-refund-ledger";

describe("synthetic refund provider ledger", () => {
  it("appends distinct broken effects while the protected lane reuses one effect", () => {
    const ledger = createSyntheticRefundLedger({
      trialId: "refund-comparison-1",
      epoch: 1,
      digest: "v1:1:pay-204:4200:USD:refund-request-204",
    });
    const input = {
      paymentId: "pay-204",
      amountMinor: 4200,
      currency: "USD",
      requestId: "refund-request-204",
    } as const;

    expect(ledger.commit({ ...input, lane: "broken" })).toMatchObject({
      created: true,
      effectId: "sim-refund-1-broken-1",
    });
    expect(ledger.commit({ ...input, lane: "broken" })).toMatchObject({
      created: true,
      effectId: "sim-refund-1-broken-2",
    });
    expect(ledger.commit({ ...input, lane: "protected" })).toMatchObject({
      created: true,
      effectId: "sim-refund-1-protected-1",
    });
    expect(ledger.commit({ ...input, lane: "protected" })).toMatchObject({
      created: false,
      effectId: "sim-refund-1-protected-1",
    });

    expect(ledger.read("broken").map(({ effectId }) => effectId)).toEqual([
      "sim-refund-1-broken-1",
      "sim-refund-1-broken-2",
    ]);
    expect(ledger.read("protected").map(({ effectId }) => effectId)).toEqual([
      "sim-refund-1-protected-1",
    ]);
    expect(Object.isFrozen(ledger.read("broken"))).toBe(true);
    expect(Object.isFrozen(ledger.read("broken")[0])).toBe(true);
  });
});
