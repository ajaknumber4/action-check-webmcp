import type { IssueRefundInput, RefundLane } from "../interface";
import { createSyntheticRefundLedger } from "../implementation/synthetic-refund-ledger";
import type {
  RefundEffectTarget,
  RefundTargetObservation,
  RefundTargetReset,
  RefundTargetRun,
} from "./refund-effect-target";

const ATTESTATION = Object.freeze({
  service: "action-check-refund-staging" as const,
  environment: "staging" as const,
  deploymentId: "browser-contract-fixture",
  capability: "refund-retry-effect-v1" as const,
  store: "in_memory_test" as const,
  attestationDigest: "browser-contract-fixture:v1",
});

/** Deterministic contract fake for unit/DOM tests. The live app injects HTTP instead. */
export function createInMemoryRefundEffectTarget(): RefundEffectTarget {
  let active: RefundTargetReset | null = null;
  let ledger: ReturnType<typeof createSyntheticRefundLedger> | null = null;
  let sequences: Record<RefundLane, number> = { broken: 0, protected: 0 };

  return Object.freeze({
    async reset(
      input: Parameters<RefundEffectTarget["reset"]>[0],
    ): Promise<RefundTargetReset> {
      ledger = createSyntheticRefundLedger(input.trialRef);
      sequences = { broken: 0, protected: 0 };
      const leaseExpiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
      const runs = Object.freeze({
        broken: run("broken", input.requestId, input.trialRef.digest, leaseExpiresAt),
        protected: run("protected", input.requestId, input.trialRef.digest, leaseExpiresAt),
      });
      active = Object.freeze({
        attestation: ATTESTATION,
        runs,
        baseline: Object.freeze({
          broken: observation(runs.broken, 0, []),
          protected: observation(runs.protected, 0, []),
        }),
      });
      return active;
    },

    async invoke(runRef: RefundTargetRun, input: IssueRefundInput): Promise<{
      runId: string;
      requestId: string;
      claim: "created" | "reused" | "ack_lost";
    }> {
      const currentLedger = requireActive(active, ledger, runRef, input);
      sequences[runRef.lane] += 1;
      const committed = currentLedger.commit(input);
      return Object.freeze({
        runId: runRef.runId,
        requestId: input.requestId,
        claim:
          sequences[runRef.lane] === 1
            ? "ack_lost"
            : committed.created
              ? "created"
              : "reused",
      });
    },

    async observe(runRef: RefundTargetRun): Promise<RefundTargetObservation> {
      if (!active || !ledger || active.runs[runRef.lane].runId !== runRef.runId) {
        throw new Error("refund_target_run_unavailable");
      }
      const effects = ledger.read(runRef.lane);
      return observation(
        runRef,
        sequences[runRef.lane],
        effects.map(({ effectId }) => effectId),
      );
    },

    async cleanup(reset: RefundTargetReset): Promise<void> {
      if (active === reset) {
        active = null;
        ledger = null;
        sequences = { broken: 0, protected: 0 };
      }
    },
  });
}

function run(
  lane: RefundLane,
  requestId: string,
  trialDigest: string,
  leaseExpiresAt: string,
): RefundTargetRun {
  return Object.freeze({
    runId: `fixture-${trialDigest.replaceAll(":", "-")}-${lane}`,
    lane,
    requestId,
    trialDigest,
    leaseExpiresAt,
    attestationDigest: ATTESTATION.attestationDigest,
  });
}

function observation(
  runRef: RefundTargetRun,
  sequence: number,
  effectIds: readonly string[],
): RefundTargetObservation {
  return Object.freeze({
    runId: runRef.runId,
    lane: runRef.lane,
    sequence,
    effectCount: effectIds.length,
    effectIds: Object.freeze([...effectIds]),
    evidenceDigest: `fixture:${runRef.runId}:${sequence}:${effectIds.join(",") || "empty"}`,
    observedAt: new Date().toISOString(),
    source: "external-refund-staging",
  });
}

function requireActive(
  active: RefundTargetReset | null,
  ledger: ReturnType<typeof createSyntheticRefundLedger> | null,
  runRef: RefundTargetRun,
  input: IssueRefundInput,
) {
  if (
    !active ||
    !ledger ||
    active.runs[runRef.lane].runId !== runRef.runId ||
    runRef.requestId !== input.requestId
  ) {
    throw new Error("refund_target_run_unavailable");
  }
  return ledger;
}
