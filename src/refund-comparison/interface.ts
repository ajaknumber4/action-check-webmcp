export type RefundLane = "broken" | "protected";

export type RefundComparisonPhase =
  | "idle"
  | "awaiting_approval"
  | "approved"
  | "running"
  | "proof_ready"
  | "closed";

export type RefundComparisonAction =
  | "stage_refund_comparison"
  | "approve_refund_comparison"
  | "issue_refund"
  | "prove_refund_comparison";

export type RefundComparisonErrorCode =
  | "HUMAN_APPROVAL_REQUIRED"
  | "APPROVAL_STALE"
  | "INPUT_MISMATCH"
  | "CALL_LIMIT_REACHED"
  | "PROOF_NOT_READY"
  | "PROVIDER_ACK_LOST_AFTER_COMMIT"
  | "TARGET_RESET_FAILED"
  | "TARGET_UNAVAILABLE"
  | "TARGET_OBSERVE_FAILED"
  | "OUTCOME_INVARIANT_FAILED"
  | "OPERATION_CANCELLED"
  | "SESSION_CLOSED";

export type RefundTrialRef = Readonly<{
  trialId: string;
  epoch: number;
  digest: string;
}>;

export type RefundTrialView = Readonly<{
  ref: RefundTrialRef;
  approvalStatus: "pending" | "approved";
  paymentId: "pay-204";
  amountMinor: 4200;
  currency: "USD";
  requestId: "refund-request-204";
}>;

export type RefundLaneView = Readonly<{
  attempts: number;
  providerRefunds: number;
  recovery: "ready" | "reset_required";
  finalState: "not_run" | "refunded_once" | "refunded_twice";
  lastClaim: "none" | "provider_ack_lost" | "created" | "reused";
}>;

export type RefundComparisonProof = Readonly<{
  status: "passed";
  summary: string;
  trialRef: RefundTrialRef;
  requestId: string;
  broken: Readonly<{
    verdict: "failed_as_expected";
    attempts: 2;
    providerRefunds: 2;
    effectIds: readonly [string, string];
  }>;
  protected: Readonly<{
    verdict: "passed";
    attempts: 2;
    providerRefunds: 1;
    effectIds: readonly [string];
  }>;
  deploymentId: string;
  attestationDigest: string;
  evidenceDigests: Readonly<Record<RefundLane, string>>;
  evidenceSource:
    | "one append-only synthetic provider ledger with separate lane records"
    | "external staging ledger read separately from the WebMCP response";
  receipt: string;
}>;

export type RefundComparisonView = Readonly<{
  phase: RefundComparisonPhase;
  trial: RefundTrialView | null;
  lanes: Readonly<Record<RefundLane, RefundLaneView>>;
  proof: RefundComparisonProof | null;
}>;

export type RefundComparisonOutcome =
  | Readonly<{
      ok: true;
      action: RefundComparisonAction;
      phase: RefundComparisonPhase;
      summary: string;
      data?: Readonly<Record<string, unknown>>;
    }>
  | Readonly<{
      ok: false;
      action: RefundComparisonAction;
      phase: RefundComparisonPhase;
      error: Readonly<{
        code: RefundComparisonErrorCode;
        message: string;
        nextAction: string;
      }>;
    }>;

export type IssueRefundInput = Readonly<{
  lane: RefundLane;
  paymentId: string;
  amountMinor: number;
  currency: string;
  requestId: string;
}>;

export type RefundComparisonExecuteOptions = Readonly<{
  signal?: AbortSignal;
}>;

export interface RefundComparisonSession {
  readonly observe: Readonly<{
    getSnapshot(): RefundComparisonView;
    subscribe(listener: () => void): () => void;
  }>;
  readonly agent: Readonly<{
    stageComparison(
      options?: RefundComparisonExecuteOptions,
    ): Promise<RefundComparisonOutcome>;
    proveComparison(
      options?: RefundComparisonExecuteOptions,
    ): Promise<RefundComparisonOutcome>;
  }>;
  readonly human: Readonly<{
    approve(
      expected: RefundTrialRef,
      options?: RefundComparisonExecuteOptions,
    ): Promise<RefundComparisonOutcome>;
  }>;
  readonly target: Readonly<{
    issueRefund(
      input: IssueRefundInput,
      options?: RefundComparisonExecuteOptions,
    ): Promise<RefundComparisonOutcome>;
  }>;
  close(): void;
}
