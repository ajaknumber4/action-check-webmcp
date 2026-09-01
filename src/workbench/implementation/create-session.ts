import {
  immediateReplayScheduler,
  ReplayCancelledError,
  type PlannedReplayStep,
  type ReplayScheduler,
} from "../adapters/replay-scheduler";
import {
  ASSURANCE_SCENARIO_OPTIONS,
  getAssuranceCase,
  isAssuranceCaseId,
} from "../fixtures/registry";
import { redirectMismatchCase } from "../fixtures/redirect-mismatch";
import type {
  AgentCommand,
  AssuranceFinding,
  AssuranceWorkbenchSession,
  AllowedAction,
  CommandKind,
  ExecuteOptions,
  FailedOutcome,
  HumanCommand,
  Outcome,
  OutcomeProofView,
  PatchRef,
  PatchView,
  ReceiptView,
  ReplayStepView,
  ReplayView,
  SafeJsonObject,
  SafeAssuranceCase,
  SuccessfulOutcome,
  WorkbenchErrorCode,
  WorkbenchPhase,
  WorkbenchView,
} from "../interface";
import { projectAllowedActions } from "./allowed-actions";
import { runAssuranceDiagnostics } from "./diagnostics";
import { deepFreeze } from "./immutable";
import { patchRefsEqual } from "./patch-versioning";
import {
  editPatch,
  isSafePatchValue,
  stageClosedAssuranceGuardrail,
} from "./repair-recipes";
import { prepareReplay } from "./replay-plan";
import { createReceipt, DEFAULT_REPORT_CHARACTER_BUDGET } from "./receipt";
import { assertSafeOutput } from "./safe-output";

export const DEFAULT_OUTCOME_CHARACTER_BUDGET = 1_500;

export type CreateAssuranceWorkbenchSessionOptions = Readonly<{
  caseId?: string;
  replayScheduler?: ReplayScheduler;
  outcomeCharacterBudget?: number;
  reportCharacterBudget?: number;
}>;

export type CreateOAuthWorkbenchSessionOptions = CreateAssuranceWorkbenchSessionOptions;

type Actor = "agent" | "human";

type InternalState = Readonly<{
  sessionEpoch: number;
  phase: WorkbenchPhase;
  safeCase: SafeAssuranceCase;
  judgment: AssuranceFinding | null;
  findings: readonly AssuranceFinding[];
  patch: PatchView | null;
  confirmedPatchRef: PatchRef | null;
  replay: ReplayView;
  proof: OutcomeProofView | null;
  receipt: ReceiptView | null;
}>;

type ActiveReplay = Readonly<{
  id: number;
  sessionEpoch: number;
  controller: AbortController;
}>;

const idleReplay: ReplayView = deepFreeze({
  status: "idle",
  steps: [],
  summary: "Not tested yet.",
});

function boundedInteger(value: number | undefined, fallback: number, minimum: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minimum, Math.floor(value));
}

function initialState(
  sessionEpoch: number,
  safeCase: SafeAssuranceCase = redirectMismatchCase,
): InternalState {
  return deepFreeze({
    sessionEpoch,
    phase: "case_loaded",
    safeCase,
    judgment: null,
    findings: [],
    patch: null,
    confirmedPatchRef: null,
    replay: idleReplay,
    proof: null,
    receipt: null,
  });
}

function refData(ref: PatchRef): SafeJsonObject {
  return {
    caseId: ref.caseId,
    sessionEpoch: ref.sessionEpoch,
    patchId: ref.patchId,
    version: ref.version,
    digest: ref.digest,
  };
}

function commandWasCancelled(options: ExecuteOptions | undefined): boolean {
  return options?.signal?.aborted === true;
}

export function createAssuranceWorkbenchSession(
  options: CreateAssuranceWorkbenchSessionOptions = {},
): AssuranceWorkbenchSession {
  const scheduler = options.replayScheduler ?? immediateReplayScheduler;
  const outcomeCharacterBudget = boundedInteger(
    options.outcomeCharacterBudget,
    DEFAULT_OUTCOME_CHARACTER_BUDGET,
    384,
  );
  const reportCharacterBudget = boundedInteger(
    options.reportCharacterBudget,
    DEFAULT_REPORT_CHARACTER_BUDGET,
    384,
  );

  let closed = false;
  let state = initialState(
    1,
    options.caseId === undefined
      ? redirectMismatchCase
      : getAssuranceCase(options.caseId) ?? redirectMismatchCase,
  );
  let view = projectView(state);
  let replaySequence = 0;
  let patchVersionSequence = 0;
  let activeReplay: ActiveReplay | null = null;
  const listeners = new Set<() => void>();

  function projectView(current: InternalState): WorkbenchView {
    const nextView: WorkbenchView = {
      sessionEpoch: current.sessionEpoch,
      sessionStatus: closed ? "closed" : "open",
      phase: current.phase,
      case: current.safeCase,
      scenarioOptions: ASSURANCE_SCENARIO_OPTIONS,
      judgment: current.judgment,
      findings: current.findings,
      patch: current.patch,
      replay: current.replay,
      proof: current.proof,
      receipt: current.receipt,
      allowedNextActions: projectAllowedActions({
        phase: current.phase,
        findings: current.findings,
        patch: current.patch,
        receipt: current.receipt,
        closed,
      }),
    };
    assertSafeOutput(nextView);
    return deepFreeze(nextView);
  }

  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A caller's listener cannot interrupt a committed domain transition.
      }
    }
  }

  function phaseIs(phase: WorkbenchPhase): boolean {
    return state.phase === phase;
  }

  function commit(next: InternalState): void {
    const frozen = deepFreeze(next);
    const projected = projectView(frozen);
    state = frozen;
    view = projected;
    notify();
  }

  function actionsFor(actor: Actor): readonly AllowedAction[] {
    return actor === "agent"
      ? view.allowedNextActions.agent
      : view.allowedNextActions.human;
  }

  function compactBudgetFailure(command: CommandKind, actor: Actor): FailedOutcome {
    return deepFreeze({
      ok: false,
      command,
      phase: state.phase,
      error: {
        code: "OUTPUT_BUDGET_EXCEEDED",
        message: "The result was withheld because it exceeded the safe output limit.",
        nextAction: "Use the visible workspace or request a narrower result.",
      },
      allowedNextActions: actionsFor(actor),
    });
  }

  function finish(outcome: Outcome, actor: Actor): Outcome {
    try {
      assertSafeOutput(outcome);
      if (JSON.stringify(outcome).length <= outcomeCharacterBudget) {
        return deepFreeze(outcome);
      }
      return compactBudgetFailure(outcome.command, actor);
    } catch {
      return deepFreeze({
        ok: false,
        command: outcome.command,
        phase: state.phase,
        error: {
          code: "INTERNAL_FAILURE",
          message: "The operation failed inside the safe output boundary.",
          nextAction: "Reset the synthetic case and retry.",
        },
        allowedNextActions: actionsFor(actor),
      });
    }
  }

  function success(
    command: CommandKind,
    actor: Actor,
    summary: string,
    data?: SafeJsonObject,
  ): SuccessfulOutcome | FailedOutcome {
    const base = {
      ok: true as const,
      command,
      phase: state.phase,
      summary,
      allowedNextActions: actionsFor(actor),
    };
    const outcome: SuccessfulOutcome = data === undefined ? base : { ...base, data };
    return finish(outcome, actor) as SuccessfulOutcome | FailedOutcome;
  }

  function failure(
    command: CommandKind,
    actor: Actor,
    code: WorkbenchErrorCode,
    message: string,
    nextAction: string,
  ): FailedOutcome {
    return finish(
      {
        ok: false,
        command,
        phase: state.phase,
        error: { code, message, nextAction },
        allowedNextActions: actionsFor(actor),
      },
      actor,
    ) as FailedOutcome;
  }

  function cancelled(command: CommandKind, actor: Actor): FailedOutcome {
    return failure(
      command,
      actor,
      "OPERATION_CANCELLED",
      "The operation was cancelled without changing external systems.",
      "Retry the operation when ready.",
    );
  }

  function closedFailure(command: CommandKind, actor: Actor): FailedOutcome {
    return failure(
      command,
      actor,
      "SESSION_CLOSED",
      "This workbench session is closed.",
      "Create a new local session.",
    );
  }

  function readCase(): Outcome {
    const legacyOAuthFacts: SafeJsonObject =
      state.safeCase.registeredRedirectUri !== undefined &&
      state.safeCase.observedRedirectUri !== undefined
        ? {
            registeredRedirectUri: state.safeCase.registeredRedirectUri,
            observedRedirectUri: state.safeCase.observedRedirectUri,
          }
        : {};
    return success("read_case", "agent", "Read the current synthetic case.", {
      caseId: state.safeCase.id,
      scenarioKind: state.safeCase.kind,
      objective: state.safeCase.objective,
      synthetic: true,
      webmcpTool: state.safeCase.effectTest?.toolName ?? null,
      effectContract: state.safeCase.effectTest?.contract ?? null,
      injectedFault: state.safeCase.effectTest?.fault ?? null,
      phase: state.phase,
      status:
        state.phase === "receipt_ready"
          ? "assurance_complete"
          : state.phase === "case_loaded"
            ? "awaiting_diagnostics"
            : "blocked",
      ...legacyOAuthFacts,
      summary: state.safeCase.summary.map((fact) => ({
        label: fact.label,
        value: fact.value,
      })),
      stagedPatch:
        state.patch === null
          ? null
          : {
              status: state.patch.approvalStatus,
              ref: refData(state.patch.ref),
              after: state.patch.after,
            },
    });
  }

  function runDiagnostics(): Outcome {
    if (state.phase !== "case_loaded") {
      return failure(
        "run_diagnostics",
        "agent",
        "INVALID_PHASE",
        "Diagnostics can start only from the loaded case.",
        "Reset the case to run diagnostics again.",
      );
    }

    const findings = runAssuranceDiagnostics(state.safeCase);
    commit({
      ...state,
      phase: "diagnosed",
      judgment: findings[0] ?? null,
      findings,
      patch: null,
      confirmedPatchRef: null,
      replay: idleReplay,
      proof: null,
      receipt: null,
    });

    return success(
      "run_diagnostics",
      "agent",
      "Loaded the failure condition and effect contract.",
      {
        caseId: state.safeCase.id,
        status: "blocked",
        findingIds: findings.map((finding) => finding.id),
        summary: findings[0]?.summary ?? "No blocking finding was detected.",
      },
    );
  }

  function explainFinding(command: Extract<AgentCommand, { kind: "explain_finding" }>): Outcome {
    if (typeof command.findingId !== "string" || command.findingId.length === 0) {
      return failure(
        command.kind,
        "agent",
        "INVALID_INPUT",
        "A non-empty finding ID is required.",
        "Use a finding ID returned by run_diagnostics.",
      );
    }

    const finding = state.findings.find((candidate) => candidate.id === command.findingId);
    if (finding === undefined) {
      return failure(
        command.kind,
        "agent",
        "FINDING_NOT_FOUND",
        "The requested finding is not present in this session.",
        "Run diagnostics and use one of the returned finding IDs.",
      );
    }

    return success(command.kind, "agent", finding.summary, {
      findingId: finding.id,
      severity: finding.severity,
      failedInvariant: finding.failedInvariant,
      evidence: finding.evidence.map((entry) => ({
        label: entry.label,
        expected: entry.expected,
        observed: entry.observed,
      })),
      smallestSafeCorrection: finding.smallestSafeCorrection,
      humanActionRequired: finding.requiresHumanApproval,
    });
  }

  function stageSandboxFix(
    command: Extract<AgentCommand, { kind: "stage_sandbox_fix" }>,
  ): Outcome {
    if (
      state.phase !== "diagnosed" &&
      state.phase !== "rejected" &&
      state.phase !== "replay_failed"
    ) {
      return failure(
        command.kind,
        "agent",
        "INVALID_PHASE",
        "A sandbox fix can be staged only after a blocking diagnosis.",
        "Run diagnostics or return to the diagnosed case.",
      );
    }

    if (typeof command.findingId !== "string" || command.findingId.length === 0) {
      return failure(
        command.kind,
        "agent",
        "INVALID_INPUT",
        "A non-empty finding ID is required.",
        "Use a finding ID returned by run_diagnostics.",
      );
    }

    const finding = state.findings.find((candidate) => candidate.id === command.findingId);
    if (finding === undefined) {
      return failure(
        command.kind,
        "agent",
        "FINDING_NOT_FOUND",
        "The requested finding is not present in this session.",
        "Use a finding ID returned by run_diagnostics.",
      );
    }

    const patch = stageClosedAssuranceGuardrail({
      safeCase: state.safeCase,
      finding,
      sessionEpoch: state.sessionEpoch,
      patchVersion: (patchVersionSequence += 1),
    });
    if (patch === null) {
      return failure(
        command.kind,
        "agent",
        "FINDING_HAS_NO_REPAIR",
        "This finding has no permitted sandbox repair.",
        "Inspect the finding and choose a repairable one.",
      );
    }

    commit({
      ...state,
      phase: "awaiting_human_approval",
      patch,
      confirmedPatchRef: null,
      replay: idleReplay,
      proof: null,
      receipt: null,
    });

    return success(
      command.kind,
      "agent",
      "Prepared the synthetic contract run; confirmation is required before execution.",
      {
        findingId: finding.id,
        patchRef: refData(patch.ref),
        field: patch.field,
        fieldLabel: patch.fieldLabel,
        before: patch.before,
        after: patch.after,
        approvalStatus: patch.approvalStatus,
      },
    );
  }

  async function replayFlow(optionsForCommand: ExecuteOptions | undefined): Promise<Outcome> {
    if (state.patch === null || state.phase === "awaiting_human_approval") {
      return failure(
        "replay_flow",
        "agent",
        "HUMAN_APPROVAL_REQUIRED",
        "Replay is blocked until a person confirms the exact current patch.",
        "Use the first-party approval control, then replay again.",
      );
    }

    if (state.phase !== "approved") {
      return failure(
        "replay_flow",
        "agent",
        "INVALID_PHASE",
        "Replay is not available in the current phase.",
        "Stage and confirm a current sandbox patch first.",
      );
    }

    if (
      state.confirmedPatchRef === null ||
      !patchRefsEqual(state.confirmedPatchRef, state.patch.ref) ||
      state.patch.approvalStatus !== "approved"
    ) {
      return failure(
        "replay_flow",
        "agent",
        "APPROVAL_STALE",
        "The recorded approval does not match the current patch.",
        "Confirm the exact current patch again.",
      );
    }

    const patch = state.patch;
    const preparation = prepareReplay(state.safeCase, patch);
    const emittedSteps: PlannedReplayStep[] = [];
    const operation: ActiveReplay = {
      id: (replaySequence += 1),
      sessionEpoch: state.sessionEpoch,
      controller: new AbortController(),
    };
    activeReplay = operation;

    const forwardCancellation = () => operation.controller.abort();
    optionsForCommand?.signal?.addEventListener("abort", forwardCancellation, { once: true });

    commit({
      ...state,
      phase: "replaying",
      replay: deepFreeze({
        status: "running",
        steps: preparation.pendingSteps,
        summary: "Replaying the deterministic synthetic flow.",
      }),
      proof: null,
      receipt: null,
    });

    try {
      await scheduler.run(preparation.plan, {
        signal: operation.controller.signal,
        onStep(step) {
          if (
            closed ||
            activeReplay?.id !== operation.id ||
            state.sessionEpoch !== operation.sessionEpoch ||
            state.phase !== "replaying"
          ) {
            return;
          }

          emittedSteps.push(deepFreeze({ ...step }));
          preparation.runtime.record(step);

          const steps = state.replay.steps.map((candidate) =>
            candidate.id === step.id ? deepFreeze({ ...step }) : candidate,
          );
          commit({
            ...state,
            replay: deepFreeze({
              ...state.replay,
              steps,
            }),
          });
        },
      });

      if (operation.controller.signal.aborted) {
        throw new ReplayCancelledError();
      }

      if (
        closed ||
        activeReplay?.id !== operation.id ||
        state.sessionEpoch !== operation.sessionEpoch ||
        !phaseIs("replaying")
      ) {
        return closed ? closedFailure("replay_flow", "agent") : cancelled("replay_flow", "agent");
      }

      const completedExactlyAsPlanned =
        emittedSteps.length === preparation.plan.length &&
        state.replay.steps.length === preparation.plan.length &&
        preparation.plan.every((planned, index) => {
          const emitted = emittedSteps[index];
          const visible = state.replay.steps[index];
          return (
            emitted?.id === planned.id &&
            emitted.label === planned.label &&
            emitted.detail === planned.detail &&
            emitted.status === planned.status &&
            visible?.id === planned.id &&
            visible.label === planned.label &&
            visible.detail === planned.detail &&
            visible.status === planned.status
          );
        });

      if (!completedExactlyAsPlanned) {
        commit({
          ...state,
          phase: "replay_failed",
          replay: deepFreeze({
            status: "failed",
            steps: state.replay.steps,
            summary: "Replay ended without completing the exact deterministic plan.",
          }),
          receipt: null,
        });
        return failure(
          "replay_flow",
          "agent",
          "INTERNAL_FAILURE",
          "Replay did not complete every deterministic proof step.",
          "Reopen or restage the sandbox patch before trying again.",
        );
      }

      const evaluation = preparation.runtime.evaluate();
      const proofPassed =
        evaluation.proof.status === "passed" &&
        evaluation.residualFindings.length === 0 &&
        emittedSteps.every((step) => step.status === "passed");

      if (!proofPassed) {
        commit({
          ...state,
          phase: "replay_failed",
          findings: evaluation.residualFindings,
          replay: deepFreeze({
            status: "failed",
            steps: state.replay.steps,
            summary: "The synthetic effect test did not satisfy its contract.",
          }),
          proof: evaluation.proof,
          receipt: null,
        });
        return success(
          "replay_flow",
          "agent",
          "The synthetic effect test completed, but its contract failed.",
          {
            status: "failed",
            assuranceDisposition: evaluation.proof.disposition,
            businessOutcome: evaluation.proof.businessOutcome,
            findingIds: evaluation.residualFindings.map((finding) => finding.id),
          },
        );
      }

      const receipt = createReceipt({
        safeCase: state.safeCase,
        patch,
        proof: evaluation.proof,
        reportCharacterBudget,
      });
      if (receipt === null) {
        commit({
          ...state,
          phase: "replay_failed",
          replay: deepFreeze({
            status: "failed",
            steps: state.replay.steps,
            summary: "Replay passed, but the bounded receipt could not be materialized.",
          }),
          receipt: null,
        });
        return failure(
          "replay_flow",
          "agent",
          "OUTPUT_BUDGET_EXCEEDED",
          "The receipt exceeded its safe output limit.",
          "Reset the case and retry with the standard report limit.",
        );
      }

      commit({
        ...state,
        phase: "receipt_ready",
        safeCase: preparation.replayedCase,
        findings: [],
        replay: deepFreeze({
          status: "succeeded",
          steps: state.replay.steps,
          summary: evaluation.proof.summary,
        }),
        proof: evaluation.proof,
        receipt,
      });

      return success(
        "replay_flow",
        "agent",
        "The synthetic effect test passed its final-state contract.",
        {
          status: "succeeded",
          assuranceDisposition: evaluation.proof.disposition,
          businessOutcome: evaluation.proof.businessOutcome,
          receiptId: receipt.id,
        },
      );
    } catch (error) {
      if (
        error instanceof ReplayCancelledError ||
        operation.controller.signal.aborted ||
        activeReplay?.id !== operation.id ||
        state.sessionEpoch !== operation.sessionEpoch
      ) {
        if (
          !closed &&
          activeReplay?.id === operation.id &&
          state.sessionEpoch === operation.sessionEpoch &&
          phaseIs("replaying")
        ) {
          commit({
            ...state,
            phase: "approved",
            replay: deepFreeze({
              status: "cancelled",
              steps: state.replay.steps,
              summary: "Replay was cancelled before completion.",
            }),
          });
        }
        return closed ? closedFailure("replay_flow", "agent") : cancelled("replay_flow", "agent");
      }

      if (!closed && state.sessionEpoch === operation.sessionEpoch && phaseIs("replaying")) {
        commit({
          ...state,
          phase: "approved",
          replay: deepFreeze({
            status: "failed",
            steps: state.replay.steps,
            summary: "Replay stopped safely after an internal failure.",
          }),
        });
      }
      return failure(
        "replay_flow",
        "agent",
        "INTERNAL_FAILURE",
        "Replay stopped safely after an internal failure.",
        "Retry the replay or reset the synthetic case.",
      );
    } finally {
      optionsForCommand?.signal?.removeEventListener("abort", forwardCancellation);
      if (activeReplay?.id === operation.id) {
        activeReplay = null;
      }
    }
  }

  function prepareReport(): Outcome {
    if (state.phase !== "receipt_ready" || state.receipt === null) {
      return failure(
        "prepare_report",
        "agent",
        "REPORT_NOT_READY",
        "A report is available only after an approved replay passes assurance.",
        "Complete the diagnosis, approval, and replay journey first.",
      );
    }

    return success("prepare_report", "agent", "Returned the bounded redacted receipt.", {
      receiptId: state.receipt.id,
      format: state.receipt.format,
      characterCount: state.receipt.characterCount,
      report: state.receipt.content,
    });
  }

  async function executeAgent(
    command: AgentCommand,
    optionsForCommand?: ExecuteOptions,
  ): Promise<Outcome> {
    let outcome: Outcome;

    if (closed) {
      return closedFailure(command.kind, "agent");
    }
    if (commandWasCancelled(optionsForCommand)) {
      outcome = cancelled(command.kind, "agent");
    } else if (
      activeReplay !== null &&
      (command.kind === "run_diagnostics" ||
        command.kind === "stage_sandbox_fix" ||
        command.kind === "replay_flow")
    ) {
      outcome = failure(
        command.kind,
        "agent",
        "OPERATION_IN_PROGRESS",
        "A replay mutation is already in progress.",
        "Wait for replay to finish or reset the case.",
      );
    } else {
      try {
        switch (command.kind) {
          case "read_case":
            outcome = readCase();
            break;
          case "run_diagnostics":
            outcome = runDiagnostics();
            break;
          case "explain_finding":
            outcome = explainFinding(command);
            break;
          case "stage_sandbox_fix":
            outcome = stageSandboxFix(command);
            break;
          case "replay_flow":
            outcome = await replayFlow(optionsForCommand);
            break;
          case "prepare_report":
            outcome = prepareReport();
            break;
        }
      } catch {
        outcome = failure(
          command.kind,
          "agent",
          "INTERNAL_FAILURE",
          "The operation stopped safely after an internal failure.",
          "Reset the synthetic case and retry.",
        );
      }
    }

    return outcome;
  }

  function requireCurrentPatchRef(
    command: Exclude<HumanCommand, { kind: "reset" }>,
  ): FailedOutcome | PatchView {
    if (state.patch === null) {
      return failure(
        command.kind,
        "human",
        "INVALID_PHASE",
        "There is no staged patch in the current phase.",
        "Run diagnostics and stage a sandbox repair first.",
      );
    }
    if (!patchRefsEqual(command.expected, state.patch.ref)) {
      return failure(
        command.kind,
        "human",
        "PATCH_REF_STALE",
        "The submitted patch reference is stale.",
        "Review and act on the currently displayed patch reference.",
      );
    }
    return state.patch;
  }

  function editCurrentPatch(command: Extract<HumanCommand, { kind: "edit_patch" }>): Outcome {
    if (
      state.phase !== "awaiting_human_approval" &&
      state.phase !== "approved" &&
      state.phase !== "rejected" &&
      state.phase !== "replay_failed"
    ) {
      return failure(
        command.kind,
        "human",
        "INVALID_PHASE",
        "The patch cannot be edited in the current phase.",
        "Stage a sandbox repair first.",
      );
    }
    const current = requireCurrentPatchRef(command);
    if ("ok" in current) {
      return current;
    }
    if (
      typeof command.after !== "string" ||
      !isSafePatchValue(state.safeCase.id, command.after)
    ) {
      return failure(
        command.kind,
        "human",
        "PATCH_VALUE_INVALID",
        "The edited value is not permitted by this closed synthetic scenario.",
        "Use one of the bounded values offered by the current guardrail.",
      );
    }

    const patch = editPatch(
      current,
      command.after,
      (patchVersionSequence += 1),
    );
    commit({
      ...state,
      phase: "awaiting_human_approval",
      patch,
      confirmedPatchRef: null,
      replay: idleReplay,
      proof: null,
      receipt: null,
    });
    return success(
      command.kind,
      "human",
      "Updated the sandbox patch and invalidated any prior approval.",
      { patchRef: refData(patch.ref), approvalStatus: patch.approvalStatus },
    );
  }

  function confirmCurrentPatch(
    command: Extract<HumanCommand, { kind: "confirm_patch" }>,
  ): Outcome {
    if (state.phase !== "awaiting_human_approval") {
      return failure(
        command.kind,
        "human",
        "INVALID_PHASE",
        "Confirmation is available only for a patch awaiting human approval.",
        "Review the current staged patch or stage a new repair.",
      );
    }
    const current = requireCurrentPatchRef(command);
    if ("ok" in current) {
      return current;
    }
    if (!isSafePatchValue(state.safeCase.id, current.after)) {
      return failure(
        command.kind,
        "human",
        "PATCH_VALUE_INVALID",
        "The current patch value is not permitted.",
        "Edit the patch to a permitted synthetic HTTPS callback URI.",
      );
    }

    const patch: PatchView = deepFreeze({ ...current, approvalStatus: "approved" });
    commit({ ...state, phase: "approved", patch, confirmedPatchRef: patch.ref });
    return success(command.kind, "human", "Confirmed the exact current sandbox patch.", {
      patchRef: refData(patch.ref),
      approvalStatus: patch.approvalStatus,
    });
  }

  function rejectCurrentPatch(command: Extract<HumanCommand, { kind: "reject_patch" }>): Outcome {
    if (
      state.phase !== "awaiting_human_approval" &&
      state.phase !== "approved" &&
      state.phase !== "rejected" &&
      state.phase !== "replay_failed"
    ) {
      return failure(
        command.kind,
        "human",
        "INVALID_PHASE",
        "Rejection is available only for a staged patch.",
        "Stage a sandbox repair first.",
      );
    }
    const current = requireCurrentPatchRef(command);
    if ("ok" in current) {
      return current;
    }

    const patch: PatchView = deepFreeze({ ...current, approvalStatus: "rejected" });
    commit({
      ...state,
      phase: "rejected",
      patch,
      confirmedPatchRef: null,
      replay: idleReplay,
      proof: null,
      receipt: null,
    });
    return success(command.kind, "human", "Rejected the current sandbox patch.", {
      patchRef: refData(patch.ref),
      approvalStatus: patch.approvalStatus,
    });
  }

  function resetCase(command: Extract<HumanCommand, { kind: "reset" }>): Outcome {
    const requestedCaseId = command.caseId ?? state.safeCase.id;
    if (!isAssuranceCaseId(requestedCaseId)) {
      return failure(
        command.kind,
        "human",
        "INVALID_INPUT",
        "The requested synthetic case is not available.",
        `Choose one of the available synthetic assurance scenarios instead.`,
      );
    }

    const requestedCase = getAssuranceCase(requestedCaseId)!;

    activeReplay?.controller.abort();
    activeReplay = null;
    patchVersionSequence = 0;
    commit(initialState(state.sessionEpoch + 1, requestedCase));
    return success(command.kind, "human", "Reset the synthetic case to its initial state.", {
      caseId: requestedCaseId,
      sessionEpoch: state.sessionEpoch,
    });
  }

  async function executeHuman(
    command: HumanCommand,
    optionsForCommand?: ExecuteOptions,
  ): Promise<Outcome> {
    if (closed) {
      return closedFailure(command.kind, "human");
    }
    if (commandWasCancelled(optionsForCommand)) {
      return cancelled(command.kind, "human");
    }
    if (activeReplay !== null && command.kind !== "reset") {
      return failure(
        command.kind,
        "human",
        "OPERATION_IN_PROGRESS",
        "A replay mutation is already in progress.",
        "Wait for replay to finish or reset the case.",
      );
    }

    try {
      switch (command.kind) {
        case "edit_patch":
          return editCurrentPatch(command);
        case "confirm_patch":
          return confirmCurrentPatch(command);
        case "reject_patch":
          return rejectCurrentPatch(command);
        case "reset":
          return resetCase(command);
      }
    } catch {
      return failure(
        command.kind,
        "human",
        "INTERNAL_FAILURE",
        "The operation stopped safely after an internal failure.",
        "Reset the synthetic case and retry.",
      );
    }
  }

  return Object.freeze({
    observe: Object.freeze({
      getSnapshot(): WorkbenchView {
        return view;
      },
      subscribe(listener: () => void): () => void {
        if (closed) {
          return () => undefined;
        }
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
    agent: Object.freeze({ execute: executeAgent }),
    human: Object.freeze({ execute: executeHuman }),
    close(): void {
      if (closed) {
        return;
      }
      activeReplay?.controller.abort();
      activeReplay = null;
      closed = true;
      view = projectView(state);
      notify();
      listeners.clear();
    },
  });
}

export const createOAuthWorkbenchSession = createAssuranceWorkbenchSession;
