import type {
  IssueRefundInput,
  RefundComparisonExecuteOptions,
  RefundLane,
  RefundTrialRef,
} from "../interface";

export type RefundTargetAttestation = Readonly<{
  service: "action-check-refund-staging";
  environment: "staging";
  deploymentId: string;
  capability: "refund-retry-effect-v1";
  store: "durable" | "in_memory_test";
  attestationDigest: string;
}>;

export type RefundTargetRun = Readonly<{
  runId: string;
  lane: RefundLane;
  requestId: string;
  trialDigest: string;
  leaseExpiresAt: string;
  attestationDigest: string;
}>;

export type RefundTargetObservation = Readonly<{
  runId: string;
  lane: RefundLane;
  sequence: number;
  effectCount: number;
  effectIds: readonly string[];
  evidenceDigest: string;
  observedAt: string;
  source: "external-refund-staging";
}>;

export type RefundTargetReset = Readonly<{
  attestation: RefundTargetAttestation;
  runs: Readonly<Record<RefundLane, RefundTargetRun>>;
  baseline: Readonly<Record<RefundLane, RefundTargetObservation>>;
}>;

export type RefundTargetInvokeClaim = Readonly<{
  runId: string;
  requestId: string;
  claim: "created" | "reused" | "ack_lost";
}>;

export interface RefundEffectTarget {
  reset(
    input: Readonly<{
      trialRef: RefundTrialRef;
      requestId: string;
    }>,
    options?: RefundComparisonExecuteOptions,
  ): Promise<RefundTargetReset>;
  invoke(
    run: RefundTargetRun,
    input: IssueRefundInput,
    options?: RefundComparisonExecuteOptions,
  ): Promise<RefundTargetInvokeClaim>;
  observe(
    run: RefundTargetRun,
    options?: RefundComparisonExecuteOptions,
  ): Promise<RefundTargetObservation>;
  cleanup(reset: RefundTargetReset): Promise<void>;
}
