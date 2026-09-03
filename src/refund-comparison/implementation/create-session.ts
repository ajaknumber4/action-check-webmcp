import type {
  IssueRefundInput,
  RefundComparisonAction,
  RefundComparisonErrorCode,
  RefundComparisonExecuteOptions,
  RefundComparisonOutcome,
  RefundComparisonPhase,
  RefundComparisonProof,
  RefundComparisonSession,
  RefundComparisonView,
  RefundLane,
  RefundLaneView,
  RefundTrialRef,
  RefundTrialView,
} from "../interface";
import type {
  RefundEffectTarget,
  RefundTargetObservation,
  RefundTargetReset,
} from "../targets/refund-effect-target";
import { createInMemoryRefundEffectTarget } from "../targets/in-memory-refund-effect-target";

const PAYMENT_ID = "pay-204" as const;
const AMOUNT_MINOR = 4200 as const;
const CURRENCY = "USD" as const;
const REQUEST_ID = "refund-request-204" as const;

type MutableLane = {
  attempts: number;
  lastClaim: RefundLaneView["lastClaim"];
  blocked: boolean;
};

type State = {
  phase: RefundComparisonPhase;
  epoch: number;
  trial: RefundTrialView | null;
  lanes: Record<RefundLane, MutableLane>;
  targetReset: RefundTargetReset | null;
  observations: Record<RefundLane, RefundTargetObservation | null>;
  proof: RefundComparisonProof | null;
};

export type RefundComparisonDependencies = Readonly<{
  target?: RefundEffectTarget;
}>;

function emptyLane(): MutableLane {
  return { attempts: 0, lastClaim: "none", blocked: false };
}

export function createRefundComparisonSession(
  dependencies: RefundComparisonDependencies = {},
): RefundComparisonSession {
  const target = dependencies.target ?? createInMemoryRefundEffectTarget();
  let closed = false;
  let state: State = {
    phase: "idle",
    epoch: 0,
    trial: null,
    lanes: { broken: emptyLane(), protected: emptyLane() },
    targetReset: null,
    observations: { broken: null, protected: null },
    proof: null,
  };
  let cachedView = snapshot(state, closed);
  const listeners = new Set<() => void>();
  let operationTail: Promise<void> = Promise.resolve();

  const getSnapshot = (): RefundComparisonView => cachedView;

  const notify = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // Presentation listeners cannot interrupt a committed trial transition.
      }
    }
  };

  const commit = (next: State): void => {
    state = next;
    cachedView = snapshot(state, closed);
    notify();
  };

  const serialize = (
    operation: () => Promise<RefundComparisonOutcome>,
  ): Promise<RefundComparisonOutcome> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  async function stageComparison(
    options?: RefundComparisonExecuteOptions,
  ): Promise<RefundComparisonOutcome> {
    const blocked = preflight("stage_refund_comparison", options);
    if (blocked) return blocked;

    const epoch = state.epoch + 1;
    const ref = trialRef(epoch);
    if (state.targetReset !== null) {
      try {
        await target.cleanup(state.targetReset);
      } catch {
        return failure(
          "stage_refund_comparison",
          "TARGET_RESET_FAILED",
          "The previous staging run could not be cleared safely.",
          "Retry after the staging target is available.",
        );
      }
      commit({
        phase: "idle",
        epoch: state.epoch,
        trial: null,
        lanes: { broken: emptyLane(), protected: emptyLane() },
        targetReset: null,
        observations: { broken: null, protected: null },
        proof: null,
      });
    }

    let targetReset: RefundTargetReset;
    try {
      targetReset = await target.reset(
        { trialRef: ref, requestId: REQUEST_ID },
        options,
      );
    } catch {
      return failure(
        "stage_refund_comparison",
        "TARGET_RESET_FAILED",
        "The staging target could not create a clean refund trial.",
        "Check the staging target connection, then stage a fresh comparison.",
      );
    }
    if (!validReset(targetReset, ref)) {
      await target.cleanup(targetReset).catch(() => undefined);
      return failure(
        "stage_refund_comparison",
        "TARGET_RESET_FAILED",
        "The staging target did not prove a zero-effect baseline for both lanes.",
        "Fix or reset the staging fixture before approving any action.",
      );
    }
    const interrupted = preflight("stage_refund_comparison", options);
    if (interrupted) {
      await target.cleanup(targetReset).catch(() => undefined);
      return interrupted;
    }
    const trial: RefundTrialView = Object.freeze({
      ref,
      approvalStatus: "pending",
      paymentId: PAYMENT_ID,
      amountMinor: AMOUNT_MINOR,
      currency: CURRENCY,
      requestId: REQUEST_ID,
    });
    commit({
      phase: "awaiting_approval",
      epoch,
      trial,
      lanes: { broken: emptyLane(), protected: emptyLane() },
      targetReset,
      observations: {
        broken: targetReset.baseline.broken,
        protected: targetReset.baseline.protected,
      },
      proof: null,
    });
    return success(
      "stage_refund_comparison",
      "awaiting_approval",
      "Reset one isolated staging comparison for human review.",
      {
        trialRef: ref,
        paymentId: PAYMENT_ID,
        amountMinor: AMOUNT_MINOR,
        currency: CURRENCY,
        requestId: REQUEST_ID,
        deploymentId: targetReset.attestation.deploymentId,
      },
    );
  }

  async function approve(
    expected: RefundTrialRef,
    options?: RefundComparisonExecuteOptions,
  ): Promise<RefundComparisonOutcome> {
    const blocked = preflight("approve_refund_comparison", options);
    if (blocked) return blocked;
    if (state.trial === null || state.phase !== "awaiting_approval") {
      return failure(
        "approve_refund_comparison",
        "APPROVAL_STALE",
        "There is no current staged comparison to approve.",
        "Ask the agent to stage a fresh refund comparison.",
      );
    }
    if (!refsEqual(expected, state.trial.ref)) {
      return failure(
        "approve_refund_comparison",
        "APPROVAL_STALE",
        "The approval does not match the exact current comparison.",
        "Review and approve the currently displayed trial.",
      );
    }

    const trial: RefundTrialView = Object.freeze({
      ...state.trial,
      approvalStatus: "approved",
    });
    commit({ ...state, phase: "approved", trial });
    return success(
      "approve_refund_comparison",
      "approved",
      "Approved the exact isolated comparison. No real payment is connected.",
      { trialRef: trial.ref },
    );
  }

  async function issueRefund(
    input: IssueRefundInput,
    options?: RefundComparisonExecuteOptions,
  ): Promise<RefundComparisonOutcome> {
    const blocked = preflight("issue_refund", options);
    if (blocked) return blocked;
    if (state.trial === null) {
      return failure(
        "issue_refund",
        "HUMAN_APPROVAL_REQUIRED",
        "No staging trial exists yet, so the refund target is blocked.",
        "Call stage_refund_comparison first; a person then approves the staged values on the page.",
      );
    }
    if (state.trial.approvalStatus !== "approved") {
      return failure(
        "issue_refund",
        "HUMAN_APPROVAL_REQUIRED",
        "The staged trial is waiting for a person to approve it on the page.",
        "Wait for the person to press Approve exact staging refund on the page, then retry this exact call; re-staging would discard the pending approval.",
      );
    }
    if (!matchesTrial(input, state.trial)) {
      return failure(
        "issue_refund",
        "INPUT_MISMATCH",
        "The requested refund does not match the human-approved payment, amount, currency, and request ID.",
        "Use the exact arguments shown in the approved comparison.",
      );
    }

    const lane = state.lanes[input.lane];
    if (lane.blocked) {
      return failure(
        "issue_refund",
        "TARGET_OBSERVE_FAILED",
        "This lane is locked because the last delivery could not be reconciled with staging evidence.",
        "Stage a fresh comparison before making another target call.",
      );
    }
    if (lane.attempts >= 2) {
      return failure(
        "issue_refund",
        "CALL_LIMIT_REACHED",
        "This lane already received the two approved delivery attempts.",
        "Prove the comparison or stage a fresh trial.",
      );
    }

    if (state.targetReset === null) {
      return failure(
        "issue_refund",
        "TARGET_UNAVAILABLE",
        "The isolated staging target is unavailable for this trial.",
        "Stage a fresh comparison and request approval again.",
      );
    }

    const attempts = lane.attempts + 1;
    const firstDelivery = attempts === 1;
    const run = state.targetReset.runs[input.lane];
    const previousObservation = state.observations[input.lane];
    const reconcileUncertainInvoke = async (
      error?: unknown,
    ): Promise<RefundComparisonOutcome> => {
      let reconciled: RefundTargetObservation;
      try {
        reconciled = await target.observe(run);
      } catch {
        commit({
          ...state,
          phase: "running",
          lanes: {
            ...state.lanes,
            [input.lane]: { ...lane, blocked: true },
          },
          proof: null,
        });
        return failure(
          "issue_refund",
          "TARGET_OBSERVE_FAILED",
          "The target response was uncertain and the staging ledger could not reconcile it.",
          "Stage a fresh comparison before retrying this lane.",
        );
      }

      if (
        validInvocationTransition(
          reconciled,
          previousObservation,
          run,
          attempts,
        )
      ) {
        const reconciledLane: MutableLane = {
          attempts,
          lastClaim: "provider_ack_lost",
          blocked: false,
        };
        commit({
          ...state,
          phase: "running",
          lanes: { ...state.lanes, [input.lane]: reconciledLane },
          observations: { ...state.observations, [input.lane]: reconciled },
          proof: null,
        });
        return failure(
          "issue_refund",
          "PROVIDER_ACK_LOST_AFTER_COMMIT",
          "The staging ledger shows the refund committed even though its response was missing or invalid.",
          attempts < 2
            ? "Retry once with the same request ID."
            : "Do not retry again; prove the comparison.",
        );
      }

      if (
        unchangedObservation(
          reconciled,
          previousObservation,
          run,
          lane.attempts,
        )
      ) {
        return failure(
          "issue_refund",
          error !== undefined &&
              (options?.signal?.aborted || isAbortError(error))
            ? "OPERATION_CANCELLED"
            : "TARGET_UNAVAILABLE",
          "The staging ledger confirms that the uncertain call created no new delivery.",
          "Retry only if this exact comparison is still current.",
        );
      }

      commit({
        ...state,
        phase: "running",
        lanes: {
          ...state.lanes,
          [input.lane]: { ...lane, blocked: true },
        },
        proof: null,
      });
      return failure(
        "issue_refund",
        "TARGET_OBSERVE_FAILED",
        "The target response was uncertain and the ledger sequence did not match this session.",
        "Stage a fresh comparison before retrying this lane.",
      );
    };
    let claim: Awaited<ReturnType<RefundEffectTarget["invoke"]>>;
    try {
      claim = await target.invoke(run, input, options);
    } catch (error: unknown) {
      return reconcileUncertainInvoke(error);
    }
    if (
      claim.runId !== run.runId ||
      claim.requestId !== input.requestId ||
      !["created", "reused", "ack_lost"].includes(claim.claim)
    ) {
      return reconcileUncertainInvoke();
    }

    const nextLane: MutableLane = {
      attempts,
      lastClaim:
        claim.claim === "ack_lost" ? "provider_ack_lost" : claim.claim,
      blocked: false,
    };

    let observed: RefundTargetObservation;
    try {
      observed = await target.observe(run);
    } catch {
      commit({
        ...state,
        phase: "running",
        lanes: {
          ...state.lanes,
          [input.lane]: { ...nextLane, blocked: true },
        },
        proof: null,
      });
      return failure(
        "issue_refund",
        "TARGET_OBSERVE_FAILED",
        "The target call completed, but the separate staging-ledger evidence could not be read.",
        "Stage a fresh comparison after the observation endpoint is restored.",
      );
    }
    if (
      !validInvocationTransition(
        observed,
        previousObservation,
        run,
        attempts,
      )
    ) {
      commit({
        ...state,
        phase: "running",
        lanes: {
          ...state.lanes,
          [input.lane]: { ...nextLane, blocked: true },
        },
        proof: null,
      });
      return failure(
        "issue_refund",
        "TARGET_OBSERVE_FAILED",
        "The target call completed, but the separate observation was stale or mismatched.",
        "Stage a fresh comparison before judging another run.",
      );
    }

    commit({
      ...state,
      phase: "running",
      lanes: { ...state.lanes, [input.lane]: nextLane },
      observations: { ...state.observations, [input.lane]: observed },
      proof: null,
    });

    if (firstDelivery && claim.claim === "ack_lost") {
      return failure(
        "issue_refund",
        "PROVIDER_ACK_LOST_AFTER_COMMIT",
        "The staging target committed the refund, then returned an uncertain acknowledgement.",
        "Retry once with the same request ID.",
      );
    }

    return success(
      "issue_refund",
      "running",
      "The staging target accepted the call. Outcome proof still depends on separate observation.",
      {
        lane: input.lane,
        attempt: attempts,
        claim:
          claim.claim === "reused"
            ? "existing_refund_reused"
            : "new_refund_created",
      },
    );
  }

  async function proveComparison(
    options?: RefundComparisonExecuteOptions,
  ): Promise<RefundComparisonOutcome> {
    const blocked = preflight("prove_refund_comparison", options);
    if (blocked) return blocked;
    const broken = state.lanes.broken;
    const protectedLane = state.lanes.protected;
    if (broken.blocked || protectedLane.blocked) {
      return failure(
        "prove_refund_comparison",
        "TARGET_OBSERVE_FAILED",
        "Proof is blocked because at least one delivery did not match its expected ledger transition.",
        "Stage a fresh comparison before asking Action Check to prove an outcome.",
      );
    }
    if (broken.attempts !== 2 || protectedLane.attempts !== 2) {
      return failure(
        "prove_refund_comparison",
        "PROOF_NOT_READY",
        "Both lanes must receive exactly two approved deliveries before proof is available.",
        "Call issue_refund twice for each lane using the approved arguments.",
      );
    }
    if (state.targetReset === null) {
      return failure(
        "prove_refund_comparison",
        "TARGET_UNAVAILABLE",
        "No staging target run is bound to the current trial.",
        "Stage a fresh comparison and run both lanes.",
      );
    }
    let brokenObservation: RefundTargetObservation;
    let protectedObservation: RefundTargetObservation;
    try {
      [brokenObservation, protectedObservation] = await Promise.all([
        target.observe(state.targetReset.runs.broken, options),
        target.observe(state.targetReset.runs.protected, options),
      ]);
    } catch {
      return failure(
        "prove_refund_comparison",
        "TARGET_OBSERVE_FAILED",
        "Fresh staging evidence could not be read from both lanes.",
        "Restore the observation endpoint before judging this run.",
      );
    }
    if (
      !unchangedObservation(
        brokenObservation,
        state.observations.broken,
        state.targetReset.runs.broken,
        2,
      ) ||
      !unchangedObservation(
        protectedObservation,
        state.observations.protected,
        state.targetReset.runs.protected,
        2,
      )
    ) {
      return failure(
        "prove_refund_comparison",
        "TARGET_OBSERVE_FAILED",
        "The staging evidence was stale, malformed, or bound to a different run.",
        "Reset the comparison before attempting another proof.",
      );
    }
    commit({
      ...state,
      observations: {
        broken: brokenObservation,
        protected: protectedObservation,
      },
      proof: null,
    });
    if (
      brokenObservation.effectCount !== 2 ||
      protectedObservation.effectCount !== 1
    ) {
      return failure(
        "prove_refund_comparison",
        "OUTCOME_INVARIANT_FAILED",
        "The observed staging effects did not catch one unsafe duplicate and one protected retry.",
        "Inspect the target and observer evidence before treating either tool response as success.",
      );
    }

    const trial = state.trial;
    if (trial === null) {
      return failure(
        "prove_refund_comparison",
        "PROOF_NOT_READY",
        "No approved trial is available for proof.",
        "Stage a fresh comparison and request approval.",
      );
    }
    const brokenEffectIds: readonly [string, string] = Object.freeze([
      brokenObservation.effectIds[0]!,
      brokenObservation.effectIds[1]!,
    ]);
    const protectedEffectIds: readonly [string] = Object.freeze([
      protectedObservation.effectIds[0]!,
    ]);
    const evidenceSource =
      state.targetReset.attestation.store === "durable"
        ? "external staging ledger read separately from the WebMCP response"
        : "one append-only synthetic provider ledger with separate lane records";
    const receipt = [
      "# Refund retry proof",
      "",
      "- WebMCP target: issue_refund",
      `- Trial ID: ${trial.ref.trialId}`,
      `- Trial digest: ${trial.ref.digest}`,
      `- Request ID: ${trial.requestId}`,
      "- Known-bad lane: FAIL (expected), 2 calls / 2 staging refunds",
      `- Broken effect IDs: ${brokenEffectIds.join(", ")}`,
      "- Protected lane: PASS, 2 calls / 1 staging refund",
      `- Protected effect ID: ${protectedEffectIds[0]}`,
      `- Staging deployment: ${state.targetReset.attestation.deploymentId}`,
      `- Evidence: ${evidenceSource}`,
      "- Production effects: none",
    ].join("\n");
    const proof: RefundComparisonProof = Object.freeze({
      status: "passed",
      summary: "The checker caught the unsafe duplicate and verified the protected retry created one staging refund.",
      trialRef: trial.ref,
      requestId: trial.requestId,
      broken: Object.freeze({
        verdict: "failed_as_expected",
        attempts: 2,
        providerRefunds: 2,
        effectIds: brokenEffectIds,
      }),
      protected: Object.freeze({
        verdict: "passed",
        attempts: 2,
        providerRefunds: 1,
        effectIds: protectedEffectIds,
      }),
      deploymentId: state.targetReset.attestation.deploymentId,
      attestationDigest: state.targetReset.attestation.attestationDigest,
      evidenceDigests: Object.freeze({
        broken: brokenObservation.evidenceDigest,
        protected: protectedObservation.evidenceDigest,
      }),
      evidenceSource,
      receipt,
    });
    commit({ ...state, phase: "proof_ready", proof });
    return success(
      "prove_refund_comparison",
      "proof_ready",
      proof.summary,
      { proof },
    );
  }

  function preflight(
    action: RefundComparisonAction,
    options: RefundComparisonExecuteOptions | undefined,
  ): RefundComparisonOutcome | null {
    if (closed) {
      return failure(
        action,
        "SESSION_CLOSED",
        "The refund comparison session is closed.",
        "Reload the page to create a new isolated session.",
      );
    }
    if (options?.signal?.aborted) {
      return failure(
        action,
        "OPERATION_CANCELLED",
        "The operation was cancelled before Action Check committed a new workflow state.",
        "Retry only if the comparison is still current.",
      );
    }
    return null;
  }

  return Object.freeze({
    observe: Object.freeze({
      getSnapshot,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
    agent: Object.freeze({
      stageComparison: (options?: RefundComparisonExecuteOptions) =>
        serialize(() => stageComparison(options)),
      proveComparison: (options?: RefundComparisonExecuteOptions) =>
        serialize(() => proveComparison(options)),
    }),
    human: Object.freeze({
      approve: (expected: RefundTrialRef, options?: RefundComparisonExecuteOptions) =>
        serialize(() => approve(expected, options)),
    }),
    target: Object.freeze({
      issueRefund: (
        input: IssueRefundInput,
        options?: RefundComparisonExecuteOptions,
      ) => serialize(() => issueRefund(input, options)),
    }),
    close() {
      if (closed) return;
      closed = true;
      cachedView = snapshot(state, closed);
      notify();
      listeners.clear();
      void operationTail.then(
        () =>
          state.targetReset === null
            ? undefined
            : target.cleanup(state.targetReset).catch(() => undefined),
        () => undefined,
      );
    },
  });

  function failure(
    action: RefundComparisonAction,
    code: RefundComparisonErrorCode,
    message: string,
    nextAction: string,
  ): RefundComparisonOutcome {
    return Object.freeze({
      ok: false,
      action,
      phase: closed ? "closed" : state.phase,
      error: Object.freeze({ code, message, nextAction }),
    });
  }
}

function success(
  action: RefundComparisonAction,
  phase: RefundComparisonPhase,
  summary: string,
  data?: Readonly<Record<string, unknown>>,
): RefundComparisonOutcome {
  return Object.freeze({ ok: true, action, phase, summary, ...(data ? { data } : {}) });
}

function trialRef(epoch: number): RefundTrialRef {
  return Object.freeze({
    trialId: `refund-comparison-${epoch}`,
    epoch,
    digest: `v1:${epoch}:${PAYMENT_ID}:${AMOUNT_MINOR}:${CURRENCY}:${REQUEST_ID}`,
  });
}

function refsEqual(left: RefundTrialRef, right: RefundTrialRef): boolean {
  return (
    left.trialId === right.trialId &&
    left.epoch === right.epoch &&
    left.digest === right.digest
  );
}

function matchesTrial(input: IssueRefundInput, trial: RefundTrialView): boolean {
  return (
    (input.lane === "broken" || input.lane === "protected") &&
    input.paymentId === trial.paymentId &&
    input.amountMinor === trial.amountMinor &&
    input.currency === trial.currency &&
    input.requestId === trial.requestId
  );
}

function snapshot(
  state: State,
  closed: boolean,
): RefundComparisonView {
  return Object.freeze({
    phase: closed ? "closed" : state.phase,
    trial: state.trial,
    lanes: Object.freeze({
      broken: laneView(
        state.lanes.broken,
        state.observations.broken?.effectCount ?? 0,
      ),
      protected: laneView(
        state.lanes.protected,
        state.observations.protected?.effectCount ?? 0,
      ),
    }),
    proof: state.proof,
  });
}

function validReset(
  reset: RefundTargetReset,
  ref: RefundTrialRef,
): boolean {
  const attestation = reset.attestation;
  if (
    attestation.service !== "action-check-refund-staging" ||
    attestation.environment !== "staging" ||
    attestation.capability !== "refund-retry-effect-v1" ||
    !attestation.deploymentId ||
    !attestation.attestationDigest ||
    reset.runs.broken.runId === reset.runs.protected.runId
  ) {
    return false;
  }
  return (["broken", "protected"] as const).every((lane) => {
    const run = reset.runs[lane];
    const baseline = reset.baseline[lane];
    return (
      run.lane === lane &&
      run.requestId === REQUEST_ID &&
      run.trialDigest === ref.digest &&
      run.attestationDigest === attestation.attestationDigest &&
      Number.isFinite(Date.parse(run.leaseExpiresAt)) &&
      Date.parse(run.leaseExpiresAt) > Date.now() &&
      baseline.sequence === 0 &&
      baseline.effectCount === 0 &&
      baseline.effectIds.length === 0 &&
      validObservation(baseline, run, 0)
    );
  });
}

function validObservation(
  observation: RefundTargetObservation,
  run: RefundTargetReset["runs"][RefundLane],
  minimumSequence: number,
): boolean {
  return (
    observation.source === "external-refund-staging" &&
    observation.runId === run.runId &&
    observation.lane === run.lane &&
    Number.isInteger(observation.sequence) &&
    observation.sequence === minimumSequence &&
    Number.isInteger(observation.effectCount) &&
    observation.effectCount >= 0 &&
    observation.effectCount === observation.effectIds.length &&
    new Set(observation.effectIds).size === observation.effectIds.length &&
    observation.effectIds.every((effectId) => effectId.length > 0) &&
    observation.evidenceDigest.length > 0 &&
    Number.isFinite(Date.parse(observation.observedAt))
  );
}

function validInvocationTransition(
  observation: RefundTargetObservation,
  previous: RefundTargetObservation | null,
  run: RefundTargetReset["runs"][RefundLane],
  attempt: number,
): boolean {
  if (
    previous === null ||
    !validObservation(previous, run, attempt - 1) ||
    !validObservation(observation, run, attempt) ||
    observation.evidenceDigest === previous.evidenceDigest
  ) {
    return false;
  }

  if (attempt === 1) {
    return previous.effectCount === 0 && observation.effectCount === 1;
  }
  if (attempt !== 2 || previous.effectCount !== 1) return false;

  if (run.lane === "protected") {
    return (
      observation.effectCount === 1 &&
      observation.effectIds[0] === previous.effectIds[0]
    );
  }

  const previousId = previous.effectIds[0];
  return (
    observation.effectCount === 2 &&
    previousId !== undefined &&
    observation.effectIds.includes(previousId) &&
    observation.effectIds.filter((effectId) => effectId !== previousId).length === 1
  );
}

function unchangedObservation(
  observation: RefundTargetObservation,
  previous: RefundTargetObservation | null,
  run: RefundTargetReset["runs"][RefundLane],
  sequence: number,
): boolean {
  return (
    previous !== null &&
    validObservation(previous, run, sequence) &&
    validObservation(observation, run, sequence) &&
    observation.effectCount === previous.effectCount &&
    observation.effectIds.length === previous.effectIds.length &&
    observation.effectIds.every(
      (effectId, index) => effectId === previous.effectIds[index],
    ) &&
    observation.evidenceDigest === previous.evidenceDigest
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function laneView(lane: MutableLane, providerRefunds: number): RefundLaneView {
  return Object.freeze({
    attempts: lane.attempts,
    providerRefunds,
    recovery: lane.blocked ? "reset_required" : "ready",
    finalState:
      providerRefunds === 0
        ? "not_run"
        : providerRefunds === 1
          ? "refunded_once"
          : "refunded_twice",
    lastClaim: lane.lastClaim,
  });
}
