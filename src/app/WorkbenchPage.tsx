import { useRef, useState } from "react";
import type {
  AgentCommand,
  EffectTestProfile,
  HumanCommand,
  Outcome,
  PatchRef,
  WorkbenchView,
} from "../workbench/interface";
import type {
  RefundComparisonView,
  RefundTrialRef,
} from "../refund-comparison";
import { CheckIcon, CrossIcon, DownloadIcon, PlayIcon } from "./icons";
import {
  RefundProofHero,
  type RefundProofRegistration,
  type RefundProofSimulation,
  type RefundStagingTargetStatus,
} from "./RefundProofHero";

export type ExternalTargetCanaryDisplay =
  | Readonly<{ state: "checking" }>
  | Readonly<{ state: "blocked"; reason: string }>
  | Readonly<{ state: "ready"; deploymentId: string }>
  | Readonly<{ state: "running"; deploymentId: string }>
  | Readonly<{ state: "passed"; deploymentId: string }>
  | Readonly<{
      state: "failed" | "inconclusive";
      deploymentId: string;
      reason: string;
    }>;

type WorkbenchPageProps = Readonly<{
  view: WorkbenchView;
  refundComparison: RefundComparisonView;
  registration: RefundProofRegistration;
  stagingTarget?: RefundStagingTargetStatus;
  refundComparisonSimulation?: RefundProofSimulation;
  externalTargetCanary: ExternalTargetCanaryDisplay;
  onRunExternalTargetCanary(): Promise<void>;
  onApproveRefundComparison(expected: RefundTrialRef): Promise<void>;
  executeAgent(command: AgentCommand): Promise<Outcome>;
  executeHuman(command: HumanCommand): Promise<Outcome>;
}>;

type TestStatus = "idle" | "running" | "passed" | "failed" | "caught";
type RunMode = "contract" | "negative-control";

const CONTRACT_ROWS = [
  ["readBefore", "readBefore"],
  ["precondition", "precondition"],
  ["approvalBinding", "approvalBinding"],
  ["idempotencyKey", "idempotencyKey"],
  ["execute", "execute"],
  ["readAfter", "readAfter"],
  ["postcondition", "postcondition"],
] as const;

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function WorkbenchPage({
  view,
  refundComparison,
  registration,
  stagingTarget,
  refundComparisonSimulation,
  externalTargetCanary,
  onRunExternalTargetCanary,
  onApproveRefundComparison,
  executeAgent,
  executeHuman,
}: WorkbenchPageProps) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [runResults, setRunResults] = useState<Record<string, TestStatus>>({});
  const [runModes, setRunModes] = useState<Record<string, RunMode>>({});
  const [notice, setNotice] = useState("");
  const actionSequence = useRef(0);
  const profile = view.case.effectTest ?? legacyProfile(view);

  const setResult = (caseId: string, status: TestStatus) => {
    setRunResults((current) => ({ ...current, [caseId]: status }));
  };

  const executeScenario = async (
    caseId: string,
    mode: RunMode = "contract",
  ): Promise<boolean> => {
    setRunModes((current) => ({ ...current, [caseId]: mode }));
    setResult(caseId, "running");

    const reset = await executeHuman({ kind: "reset", caseId });
    if (!reset.ok) return finishFailedRun(caseId, reset);

    const diagnosis = await executeAgent({ kind: "run_diagnostics" });
    const findingId = firstFindingId(diagnosis);
    if (!diagnosis.ok || findingId === null) return finishFailedRun(caseId, diagnosis);

    const staged = await executeAgent({ kind: "stage_sandbox_fix", findingId });
    let patchRef = patchRefFrom(staged);
    if (!staged.ok || patchRef === null) return finishFailedRun(caseId, staged);

    if (mode === "negative-control") {
      const negativeValue = stringDataFrom(staged, "before");
      if (negativeValue === null) return finishFailedRun(caseId, staged);
      const edited = await executeHuman({
        kind: "edit_patch",
        expected: patchRef,
        after: negativeValue,
      });
      patchRef = patchRefFrom(edited);
      if (!edited.ok || patchRef === null) return finishFailedRun(caseId, edited);
    }

    const confirmed = await executeHuman({ kind: "confirm_patch", expected: patchRef });
    if (!confirmed.ok) return finishFailedRun(caseId, confirmed);

    const replayed = await executeAgent({ kind: "replay_flow" });
    const contractPassed = replayed.ok && replayed.data?.status === "succeeded";
    const brokenVersionCaught =
      mode === "negative-control" &&
      replayed.ok &&
      replayed.data?.status === "failed";
    setResult(
      caseId,
      mode === "negative-control"
        ? brokenVersionCaught
          ? "caught"
          : "failed"
        : contractPassed
          ? "passed"
          : "failed",
    );
    setNotice(replayed.ok ? "" : replayed.error.message);
    return mode === "negative-control" ? brokenVersionCaught : contractPassed;

    function finishFailedRun(failedCaseId: string, outcome: Outcome): false {
      setResult(failedCaseId, "failed");
      setNotice(outcome.ok ? outcome.summary : outcome.error.message);
      return false;
    }
  };

  const runCurrent = async (mode: RunMode = "contract") => {
    const actionId = ++actionSequence.current;
    setBusyAction(view.case.id);
    try {
      await executeScenario(
        view.case.id,
        mode,
      );
    } finally {
      if (actionId === actionSequence.current) setBusyAction(null);
    }
  };

  const runAll = async () => {
    const actionId = ++actionSequence.current;
    const selectedId = view.case.id;
    const order = [
      ...view.scenarioOptions.filter((option) => option.id !== selectedId),
      ...view.scenarioOptions.filter((option) => option.id === selectedId),
    ];
    setBusyAction("run-all");
    try {
      for (const option of order) await executeScenario(option.id);
    } finally {
      if (actionId === actionSequence.current) setBusyAction(null);
    }
  };

  const switchScenario = async (caseId: string) => {
    const actionId = ++actionSequence.current;
    setBusyAction("switch");
    const outcome = await executeHuman({ kind: "reset", caseId });
    if (actionId === actionSequence.current) {
      setBusyAction(null);
      setNotice(outcome.ok ? "" : outcome.error.message);
    }
  };

  const downloadReport = () => {
    if (!view.receipt) return;
    const blob = new Blob([view.receipt.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = view.case.id + "-effect-test-report.md";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const recordedStatus = runResults[view.case.id];
  const currentStatus: TestStatus =
    busyAction !== null && view.replay.status === "running"
      ? "running"
      : recordedStatus !== undefined
        ? recordedStatus
      : view.proof?.status === "passed"
        ? "passed"
        : view.proof?.status === "failed"
          ? "failed"
          : "idle";
  const currentRunMode = runModes[view.case.id] ?? "contract";

  return (
    <div className="workbench">
      <header className="app-header">
        <div className="project-name">
          <span className="product-mark" aria-hidden="true">AC</span>
          <span className="project-copy">
            <strong>Action Check</strong>
            <small>WebMCP effect tests</small>
          </span>
        </div>
        <div className="header-actions">
          <span className="contract-count">{view.scenarioOptions.length} synthetic contracts</span>
          <button className="run-all-button" type="button" disabled={busyAction !== null} onClick={() => void runAll()}>
            <PlayIcon /> {busyAction === "run-all" ? "Running 4 UI examples…" : "Run 4 UI examples"}
          </button>
        </div>
      </header>

      <main className="runner-shell">
        <section className="runner-hero" aria-labelledby="page-title">
          <header className="runner-intro">
            <h1 id="page-title">Test what WebMCP actions actually change.</h1>
            <p>
              Action Check is a browser test lab for developers and QA teams building agent
              actions. It catches duplicate effects, stale approvals, and false success before production.
            </p>
            <small>External synthetic staging demo · no payment account connected · no real money moves</small>
          </header>

          <RefundProofHero
            view={refundComparison}
            registration={registration}
            stagingTarget={stagingTarget}
            simulation={refundComparisonSimulation}
            onApprove={onApproveRefundComparison}
          />
        </section>

        <ScenarioSuite view={view} results={runResults} disabled={busyAction !== null} onSelect={switchScenario} />

        <section className="runner-details" aria-label="Supporting effect tests">
          <TestPath status={currentStatus} />

          <div className="selected-test-heading">
            <div>
              <span>{profile.industry} / <code>{profile.toolName}</code></span>
              <h2>{view.case.title}</h2>
              <p>{profile.intent}</p>
            </div>
            <div className="passing-rule">
              <small>Passing behavior</small>
              <strong>{profile.passingBehavior}</strong>
            </div>
          </div>

          {view.case.kind === "social_publish" ? (
            <ExternalTargetCanaryPanel
              canary={externalTargetCanary}
              onRun={onRunExternalTargetCanary}
            />
          ) : null}

          <div className="contract-fault-grid">
            <VerificationRulePanel profile={profile} />
            <FaultPanel
              profile={profile}
              status={currentStatus}
              disabled={busyAction !== null}
              onRun={() => runCurrent("contract")}
              onRunBroken={() => runCurrent("negative-control")}
              simulated={view.case.kind === "social_publish"}
            />
          </div>

          <ReportPanel view={view} profile={profile} status={currentStatus} runMode={currentRunMode} />
          <TechnicalDetails view={view} profile={profile} onDownload={downloadReport} />
          <p className="operation-notice visually-hidden" aria-live="polite">{notice}</p>
        </section>
      </main>
    </div>
  );
}

function ExternalTargetCanaryPanel({
  canary,
  onRun,
}: {
  canary: ExternalTargetCanaryDisplay;
  onRun(): Promise<void>;
}) {
  const { title, description, eyebrow, canRun } =
    externalTargetCanaryPresentation(canary);

  return (
    <section
      className={classes("staging-canary", `canary-panel-${canary.state}`)}
      aria-labelledby="external-target-canary-region-title"
    >
      <h3 id="external-target-canary-region-title" className="visually-hidden">
        External Target staging check
      </h3>
      <div className="canary-status" aria-live="polite">
        <small>{eyebrow}</small>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {canary.state === "passed" ? (
        <dl className="canary-proof">
          <div><dt>False claim</dt><dd>Rejected</dd></div>
          <div><dt>Truthful control</dt><dd>Accepted</dd></div>
        </dl>
      ) : null}
      {canRun ? (
        <button
          className="canary-run-button"
          type="button"
          onClick={() => void onRun()}
        >
          <PlayIcon /> {canary.state === "ready" ? "Run staging check" : "Run again"}
        </button>
      ) : null}
      {canary.state === "running" ? <span className="canary-running-indicator" aria-hidden="true">···</span> : null}
    </section>
  );
}

type ExternalTargetCanaryPresentation = Readonly<{
  title: string;
  description: string;
  eyebrow: string;
  canRun: boolean;
}>;

function externalTargetCanaryPresentation(
  canary: ExternalTargetCanaryDisplay,
): ExternalTargetCanaryPresentation {
  switch (canary.state) {
    case "checking":
      return {
        title: "Checking optional staging…",
        description:
          "Confirming that the server is isolated staging before any test can run.",
        eyebrow: "OPTIONAL STAGING · CHECKING",
        canRun: false,
      };
    case "blocked":
      return {
        title: "Optional staging integration",
        description:
          "Disabled in this build. External Target staging is not configured; the UI-only fixture below remains synthetic.",
        eyebrow: "Optional external-target staging · disabled",
        canRun: false,
      };
    case "ready":
      return {
        title: "Real workflow ready",
        description:
          "Checks the real External Target worker and staging database without contacting a social network.",
        eyebrow: "EXTERNAL TARGET STAGING · NO PUBLIC POST",
        canRun: true,
      };
    case "running":
      return {
        title: "Checking External Target…",
        description:
          "Running a false claim and a truthful control in isolated staging. No social network is contacted.",
        eyebrow: "EXTERNAL TARGET STAGING · NO PUBLIC POST",
        canRun: false,
      };
    case "passed":
      return {
        title: "False success caught",
        description:
          "The false publish claim was rejected, while the matching published result was accepted.",
        eyebrow: "EXTERNAL TARGET STAGING · NO PUBLIC POST",
        canRun: true,
      };
    case "failed":
      return {
        title: "Unsafe result found",
        description:
          "The staging result did not satisfy the publish safety contract.",
        eyebrow: "EXTERNAL TARGET STAGING · NO PUBLIC POST",
        canRun: true,
      };
    case "inconclusive":
      return {
        title: "No reliable result",
        description:
          "Staging evidence was incomplete, so Action Check did not pass or fail the workflow.",
        eyebrow: "EXTERNAL TARGET STAGING · NO PUBLIC POST",
        canRun: true,
      };
    default:
      return unreachableCanaryState(canary);
  }
}

function unreachableCanaryState(state: never): never {
  throw new Error(`Unhandled External Target canary state: ${String(state)}`);
}

function ScenarioSuite({
  view,
  results,
  disabled,
  onSelect,
}: {
  view: WorkbenchView;
  results: Record<string, TestStatus>;
  disabled: boolean;
  onSelect(caseId: string): Promise<void>;
}) {
  return (
    <aside className="test-suite" aria-labelledby="suite-title">
      <header><h2 id="suite-title">Test suite</h2><small>Simulated examples</small></header>
      <ol>
        {view.scenarioOptions.map((option, index) => {
          const status = results[option.id] ?? "idle";
          return (
            <li key={option.id}>
              <button
                type="button"
                className={classes(view.case.id === option.id && "is-selected", "status-" + status)}
                aria-pressed={view.case.id === option.id}
                disabled={disabled}
                onClick={() => void onSelect(option.id)}
              >
                <span className="suite-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="suite-copy"><small>{option.industry}</small><strong>{option.label}</strong><code>{option.toolName}</code></span>
                <TestStatusIcon status={status} />
              </button>
            </li>
          );
        })}
      </ol>
      <p>These supporting fixtures use page controls, not registered agent tools.</p>
    </aside>
  );
}

function TestStatusIcon({ status }: { status: TestStatus }) {
  const label =
    status === "idle"
      ? "Not run"
      : status === "caught"
        ? "bug caught"
        : status;
  return (
    <span className={"suite-status suite-status-" + status} role="img" aria-label={label}>
      {status === "passed" ? <CheckIcon /> : status === "failed" ? <CrossIcon /> : status === "caught" ? "!" : status === "running" ? "···" : "○"}
    </span>
  );
}

function TestPath({ status }: { status: TestStatus }) {
  const labels = ["Define contract", "Inject fault", "Run tool", "Check state"];
  return (
    <ol className="test-path" aria-label="Effect test stages">
      {labels.map((label, index) => {
        const state = index < 2 ? "complete" : status === "passed" || status === "caught" ? "complete" : status === "failed" && index === 3 ? "failed" : status === "running" && index === 2 ? "current" : "pending";
        return <li key={label} className={"path-" + state} aria-current={state === "current" ? "step" : undefined}><span>{index + 1}</span><strong>{label}</strong></li>;
      })}
    </ol>
  );
}

function VerificationRulePanel({ profile }: { profile: EffectTestProfile }) {
  return (
    <section className="effect-contract" aria-labelledby="contract-title">
      <header>
        <div>
          <small>Verification rule</small>
          <h3 id="contract-title">What this test checks</h3>
        </div>
        <code>{profile.contract.effectId}</code>
      </header>
      <dl className="contract-summary">
        <div><dt>Before</dt><dd>{profile.contract.readBefore}</dd></div>
        <div><dt>Action</dt><dd><code>{profile.contract.execute}</code></dd></div>
        <div><dt>Pass only if</dt><dd>{profile.contract.postcondition}</dd></div>
      </dl>
      <details className="contract-steps">
        <summary>Show all 7 technical checks</summary>
        <ol>
          {CONTRACT_ROWS.map(([label, key], index) => (
            <li key={key}><span>{index + 1}</span><code>{label}</code><strong>{profile.contract[key]}</strong></li>
          ))}
        </ol>
      </details>
    </section>
  );
}

function FaultPanel({
  profile,
  status,
  disabled,
  onRun,
  onRunBroken,
  simulated,
}: {
  profile: EffectTestProfile;
  status: TestStatus;
  disabled: boolean;
  onRun(): Promise<void>;
  onRunBroken(): Promise<void>;
  simulated: boolean;
}) {
  return (
    <section className="fault-panel" aria-labelledby="fault-title">
      <header><span aria-hidden="true">!</span><h3 id="fault-title">Injected fault</h3></header>
      <strong>{profile.fault.label}</strong>
      <p>{profile.fault.description}</p>
      <dl>
        <div><dt>Tool under test</dt><dd><code>{profile.toolName}</code></dd></div>
        <div><dt>Pass when</dt><dd>{profile.passingBehavior}</dd></div>
      </dl>
      <div className="fault-actions">
        <button className="run-test-button" type="button" disabled={disabled} onClick={() => void onRun()}>
          <PlayIcon /> {status === "running" ? "Running test…" : status === "passed" ? "Run again" : status === "caught" ? "Run safe version" : simulated ? "Run simulated test" : "Run test"}
        </button>
        <button
          className="negative-control-button"
          type="button"
          disabled={disabled}
          title={profile.negativeControl.label}
          onClick={() => void onRunBroken()}
        >
          {status === "caught" ? "Repeat bug check" : "Prove this test catches the bug"}
        </button>
      </div>
    </section>
  );
}

function ReportPanel({
  view,
  profile,
  status,
  runMode,
}: {
  view: WorkbenchView;
  profile: EffectTestProfile;
  status: TestStatus;
  runMode: RunMode;
}) {
  if (!view.proof) {
    return (
      <section className={classes("test-report", "report-empty", status === "running" && "is-running")} aria-labelledby="report-title">
        <div className="report-verdict"><small>Check result</small><strong>{status === "running" ? "RUNNING" : "NOT RUN"}</strong></div>
        <div><h3 id="report-title">{status === "running" ? "Injecting the fault and checking state…" : "Ready to test the contract"}</h3><p>{status === "running" ? "The runner is executing deterministic synthetic steps." : "Run the tool once. Action Check will inject the failure and read the final state."}</p></div>
      </section>
    );
  }

  const contractPassed = view.proof.status === "passed";
  const expectedFailure = runMode === "negative-control";
  const brokenVersionCaught = expectedFailure && !contractPassed;
  const sensitivityMissed = expectedFailure && contractPassed;
  const reportTitle = brokenVersionCaught
    ? "Broken behavior caught"
    : sensitivityMissed
      ? "Broken behavior escaped"
      : contractPassed
        ? profile.passTitle
        : "Contract failed";
  const verdict = contractPassed ? "PASS" : "FAIL";
  const verdictLabel = expectedFailure
    ? `Deliberately broken: ${verdict}. ${reportTitle}. Sensitivity check ${brokenVersionCaught ? "passed" : "failed"}`
    : `Check result: ${verdict}. ${reportTitle}`;
  return (
    <section className={classes("test-report", brokenVersionCaught && "report-caught", sensitivityMissed || (!expectedFailure && !contractPassed) ? "report-failed" : !brokenVersionCaught && "report-passed")} aria-labelledby="report-title">
      <div className="report-verdict" role="status" aria-live="polite" aria-atomic="true" aria-label={verdictLabel}><small>{expectedFailure ? "Deliberately broken" : "Check result"}</small><strong>{verdict}</strong><span aria-hidden="true">{contractPassed ? <CheckIcon /> : <CrossIcon />}</span></div>
      <div className="report-summary">
        <h3 id="report-title">{reportTitle}</h3>
        {expectedFailure ? (
          <p className="removed-protection"><span>Protection removed</span>{profile.negativeControl.label}</p>
        ) : null}
        <p>{brokenVersionCaught ? profile.negativeControl.expectedFailure : view.proof.summary}</p>
        <dl className="result-split">
          <div><dt>Contract</dt><dd>{contractPassed ? "Passed" : "Failed"}</dd></div>
          {expectedFailure ? (
            <div className={brokenVersionCaught ? "outcome-achieved" : "outcome-unsafe"}><dt>Sensitivity check</dt><dd>{brokenVersionCaught ? "Passed" : "Failed"}</dd></div>
          ) : (
            <div className={"outcome-" + view.proof.businessOutcome}><dt>Observed outcome</dt><dd>{observedOutcomeLabel(view.proof)}</dd></div>
          )}
        </dl>
        <dl className="report-metrics">
          {view.proof.metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}
        </dl>
      </div>
      <div className="event-trace">
        <h4>Event trace</h4>
        <ol>
          {view.replay.steps.map((step, index) => <li key={step.id} className={"trace-" + step.status}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step.label}</strong></li>)}
        </ol>
      </div>
      <p className="report-rule">{brokenVersionCaught ? "The weakened contract failed as expected. This proves the test can catch the missing control." : "The test reads the system after the tool runs. A success response alone cannot pass."}</p>
    </section>
  );
}

function TechnicalDetails({
  view,
  profile,
  onDownload,
}: {
  view: WorkbenchView;
  profile: EffectTestProfile;
  onDownload(): void;
}) {
  return (
    <details className="technical-details">
      <summary>Technical details <span>contract IDs, evidence, and report</span></summary>
      <div className="technical-grid">
        <dl>
          <div><dt>Scenario</dt><dd><code>{view.case.id}</code></dd></div>
          <div><dt>Effect</dt><dd><code>{profile.contract.effectId}</code></dd></div>
          <div><dt>Target</dt><dd><code>{profile.contract.target}</code></dd></div>
          <div><dt>Evidence source</dt><dd>{profile.contract.evidenceSource}</dd></div>
          <div><dt>Execution path</dt><dd>UI-only synthetic fixture</dd></div>
        </dl>
        <p>Synthetic cases stay browser-local. The External Target check runs only through the attested server-side staging broker when connected.</p>
        {view.receipt ? <button className="download-button" type="button" onClick={onDownload}><DownloadIcon /> Download test report</button> : null}
      </div>
    </details>
  );
}

function firstFindingId(outcome: Outcome): string | null {
  if (!outcome.ok) return null;
  const findingIds = outcome.data?.findingIds;
  if (!Array.isArray(findingIds)) return null;
  return findingIds.find((value): value is string => typeof value === "string") ?? null;
}

function stringDataFrom(outcome: Outcome, key: string): string | null {
  if (!outcome.ok) return null;
  const value = outcome.data?.[key];
  return typeof value === "string" ? value : null;
}

function patchRefFrom(outcome: Outcome): PatchRef | null {
  if (!outcome.ok) return null;
  const value = outcome.data?.patchRef;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.caseId !== "string" ||
    typeof candidate.sessionEpoch !== "number" ||
    typeof candidate.patchId !== "string" ||
    typeof candidate.version !== "number" ||
    typeof candidate.digest !== "string"
  ) return null;
  return { caseId: candidate.caseId, sessionEpoch: candidate.sessionEpoch, patchId: candidate.patchId, version: candidate.version, digest: candidate.digest };
}

function observedOutcomeLabel(proof: NonNullable<WorkbenchView["proof"]>): string {
  if (proof.disposition === "false_success_detected") {
    return "Unchanged — false success caught";
  }
  if (proof.disposition === "unsafe_outcome_prevented") {
    return proof.businessOutcome === "achieved"
      ? "Safe effect achieved"
      : "Unsafe action blocked";
  }
  if (proof.disposition === "intended_outcome_verified") {
    return "Expected effect confirmed";
  }
  return "Unsafe or unverified";
}

function legacyProfile(view: WorkbenchView): EffectTestProfile {
  return {
    industry: "Social",
    toolName: "legacy_action",
    intent: view.case.objective,
    passingBehavior: "The final state satisfies the declared safety rule.",
    passTitle: "Effect verified",
    fault: {
      kind: view.case.kind === "duplicate_effect" ? "duplicate_delivery" : view.case.kind === "stale_approval" ? "state_drift" : "false_success",
      label: view.case.title,
      description: view.case.summary.find((item) => item.emphasis === "danger")?.value ?? view.case.objective,
    },
    negativeControl: {
      label: "Remove the expected safety check",
      expectedFailure: "The weakened legacy contract produces an unsafe result.",
    },
    contract: {
      effectId: "legacy.effect",
      target: view.case.id,
      readBefore: "current state",
      precondition: "approved state matches",
      approvalBinding: "target + action + version",
      idempotencyKey: "action.request_id",
      execute: "legacy_action",
      readAfter: "current state",
      postcondition: "expected state is observed",
      evidenceSource: "synthetic fixture state",
    },
  };
}
