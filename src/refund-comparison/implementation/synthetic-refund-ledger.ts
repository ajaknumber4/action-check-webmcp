import type {
  IssueRefundInput,
  RefundLane,
  RefundTrialRef,
} from "../interface";

export type SyntheticRefundEffect = Readonly<{
  effectId: string;
  trialDigest: string;
  lane: RefundLane;
  paymentId: string;
  amountMinor: number;
  currency: string;
  requestId: string;
}>;

export type SyntheticRefundCommit = Readonly<{
  created: boolean;
  effectId: string;
}>;

export interface SyntheticRefundLedger {
  commit(input: IssueRefundInput): SyntheticRefundCommit;
  read(lane: RefundLane): readonly SyntheticRefundEffect[];
}

/**
 * Browser-local stand-in for a provider's authoritative effect store. Records
 * can only be appended; proof receives frozen snapshots through read().
 */
export function createSyntheticRefundLedger(
  trialRef: RefundTrialRef,
): SyntheticRefundLedger {
  const records: Record<RefundLane, SyntheticRefundEffect[]> = {
    broken: [],
    protected: [],
  };

  return Object.freeze({
    commit(input: IssueRefundInput): SyntheticRefundCommit {
      const existing = records[input.lane].find(
        (record) => record.requestId === input.requestId,
      );
      if (input.lane === "protected" && existing) {
        return Object.freeze({ created: false, effectId: existing.effectId });
      }

      const effectId = `sim-refund-${trialRef.epoch}-${input.lane}-${records[input.lane].length + 1}`;
      const effect = Object.freeze({
        effectId,
        trialDigest: trialRef.digest,
        lane: input.lane,
        paymentId: input.paymentId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        requestId: input.requestId,
      });
      records[input.lane].push(effect);
      return Object.freeze({ created: true, effectId });
    },
    read(lane: RefundLane): readonly SyntheticRefundEffect[] {
      return Object.freeze([...records[lane]]);
    },
  });
}
