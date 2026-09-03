import { useEffect, useRef, useState } from "react";

import { REFUND_COMPARISON_TOOL_NAMES } from "../adapters/webmcp";
import type {
  RefundComparisonView,
  RefundLane,
  RefundLaneView,
  RefundTrialRef,
} from "../refund-comparison";

export type RefundProofRegistration = Readonly<{
  state: "unavailable" | "registering" | "ready" | "failed";
  label: string;
}>;

export type RefundStagingTargetStatus = Readonly<{
  state: "configured" | "missing";
  label: string;
}>;

export type RefundProofSimulationStepStatus = "pending" | "running" | "ok" | "error";

export type RefundProofSimulationStep = Readonly<{
  id: string;
  label: string;
  status: RefundProofSimulationStepStatus;
  detail: string;
}>;

export type RefundProofSimulationRunStatus =
  | "idle"
  | "running"
  | "awaiting_human_approval"
  | "complete"
  | "error";

/**
 * Drives the honesty rails for the in-page simulated-agent path: a visitor
 * without a WebMCP-capable browser can still see the real four-step proof,
 * with every simulated action clearly labelled as such. `active` tells this
 * component whether the CURRENTLY DISPLAYED trial was produced by this
 * simulated run (as opposed to a native WebMCP call, or an earlier
 * simulated run that a later native call has since replaced).
 */
export type RefundProofSimulation = Readonly<{
  /** True once native WebMCP registration is ready — offers this as a
   *  secondary comparison option instead of the primary fallback. */
  availableNatively: boolean;
  active: boolean;
  status: RefundProofSimulationRunStatus;
  steps: readonly RefundProofSimulationStep[];
  error: string;
  onRun(): void;
}>;

export type RefundProofHeroProps = Readonly<{
  view: RefundComparisonView;
  registration: RefundProofRegistration;
  stagingTarget?: RefundStagingTargetStatus;
  simulation?: RefundProofSimulation;
  onApprove(expected: RefundTrialRef): Promise<void>;
}>;

const DEFAULT_STAGING_TARGET: RefundStagingTargetStatus = Object.freeze({
  state: "configured",
  label: "External staging configured",
});

const FIXED_TRIAL = {
  paymentId: "pay-204",
  amountMinor: 4200,
  currency: "USD",
  requestId: "refund-request-204",
} as const;

const PATH_STAGES = [
  { label: "You + agent", detail: "Send the prompt; agent stages a $42 refund" },
  { label: "You", detail: "Approve the exact values" },
  { label: "Agent", detail: "Refunds twice per lane, same request ID" },
  { label: "Action Check", detail: "Reads the ledger: 2 vs 1" },
] as const;

export function RefundProofHero({
  view,
  registration,
  stagingTarget = DEFAULT_STAGING_TARGET,
  simulation,
  onApprove,
}: RefundProofHeroProps) {
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const approvalButtonRef = useRef<HTMLButtonElement>(null);
  const approvalRegionRef = useRef<HTMLElement>(null);
  const proofRegionRef = useRef<HTMLElement>(null);
  const trial = view.trial;
  const approvalPending =
    view.phase === "awaiting_approval" && trial?.approvalStatus === "pending";
  const approvalLabel =
    trial === null
      ? "Blocked"
      : trial.approvalStatus === "approved"
        ? "Approved"
        : view.phase === "closed"
          ? "Expired"
          : "Pending";
  const previousViewState = useRef({
    phase: view.phase,
    trialDigest: trial?.ref.digest ?? null,
  });
  const registrationPresentation = nativeRegistrationPresentation(
    registration,
    stagingTarget,
  );
  const prompt = agentPrompt(view);
  const simulationActive = simulation?.active ?? false;
  const rawGuide = refundWorkflowGuide(view, registration, stagingTarget, simulationActive);
  const guide = simulationActive ? withSimulatedActor(rawGuide) : rawGuide;
  // One card is "current" per step: once approval is granted the approval
  // checkpoint collapses to a bound-values summary and the retry lanes take
  // the prominent, display-size-count treatment described in the mockups.
  const pastApproval =
    view.phase === "approved" ||
    view.phase === "running" ||
    view.phase === "proof_ready";
  const simulationIsCompareOption = (simulation?.availableNatively ?? false) === true;
  // First-viewport rule: only the current step's card is visually present.
  // The approval checkpoint is required (by "explains the native webmcp
  // boundary while idle", asserting 4x "Not staged") to still exist in the
  // DOM while idle, so it collapses to a hairline instead of unmounting —
  // never display:none, so it stays in the accessibility tree.
  const approvalCollapsed = view.phase === "idle";
  // The agent-instruction row is never collapsed: it holds a 44px control
  // (gate review P2-1) and is the affordance for every agent-driven step.

  useEffect(() => {
    setCopyState("idle");
  }, [prompt]);

  useEffect(() => {
    const previous = previousViewState.current;
    const trialDigest = trial?.ref.digest ?? null;
    const newlyStaged =
      view.phase === "awaiting_approval" &&
      (previous.phase !== "awaiting_approval" || previous.trialDigest !== trialDigest);

    if (newlyStaged && trial) {
      approvalButtonRef.current?.focus();
    } else if (view.phase === "approved" && previous.phase !== "approved") {
      approvalRegionRef.current?.focus();
    } else if (view.phase === "proof_ready" && previous.phase !== "proof_ready") {
      proofRegionRef.current?.focus();
    }

    previousViewState.current = { phase: view.phase, trialDigest };
  }, [trial, view.phase]);

  const approve = async () => {
    if (!trial || !approvalPending || approving) return;
    setApproving(true);
    setApprovalError("");
    try {
      await onApprove(trial.ref);
    } catch {
      setApprovalError("Approval did not complete. Review the current trial and try again.");
    } finally {
      setApproving(false);
    }
  };

  const copyPrompt = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(prompt);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <section
      className={`refund-proof-hero refund-proof-phase-${view.phase}`}
      aria-labelledby="refund-proof-title"
    >
      <header className="refund-proof-mast">
        <div className="refund-proof-title-block">
          <span className="refund-proof-kicker">{registrationPresentation.kicker}</span>
          <h2 id="refund-proof-title">Can one retry accidentally refund twice?</h2>
          <p>{registrationPresentation.description}</p>
        </div>
        <div
          className={`refund-proof-registration refund-proof-registration-${registration.state}`}
          role="status"
          aria-live="polite"
        >
          <span className="refund-proof-registration-light" aria-hidden="true" />
          <span>
            <small>Native WebMCP</small>
            <strong>{registration.label}</strong>
            {registration.state === "unavailable" ? (
              <small className="refund-proof-registration-hint">
                Open in Chrome 149+ (WebMCP flag) or ChatGPT’s browser
              </small>
            ) : null}
          </span>
        </div>
        {simulationActive ? (
          <p className="refund-proof-simulation-badge" role="status">
            <span aria-hidden="true">SIM</span>
            <span className="refund-proof-simulation-badge-text">
              {simulationBadgeCopy(registration)}
            </span>
          </p>
        ) : null}
      </header>

      <section className="refund-proof-tool-strip" aria-labelledby="refund-proof-tools-title">
        <div className="refund-proof-tool-strip-label">
          <strong id="refund-proof-tools-title">Agent tools</strong>
          <small>Available on this page</small>
        </div>
        <ul>
          {REFUND_COMPARISON_TOOL_NAMES.map((toolName) => (
            <li key={toolName}><code>{toolName}</code></li>
          ))}
        </ul>
        <div
          className={`refund-proof-tool-state refund-proof-tool-state-${registration.state}`}
        >
          <span aria-hidden="true" />
          <strong
            role="status"
            aria-label={`Native WebMCP tools: ${registrationPresentation.toolStateLabel}; ${registrationPresentation.registeredToolsLabel}`}
          >
            {registrationPresentation.toolStateLabel}
          </strong>
          <small>{registrationPresentation.registeredToolsLabel}</small>
          <div
            className={`refund-proof-target-state refund-proof-target-state-${stagingTarget.state}`}
            role="status"
            aria-label={`External staging target: ${stagingTarget.label}`}
          >
            <span aria-hidden="true" />
            <small>External target</small>
            <strong>{stagingTarget.label}</strong>
          </div>
        </div>
      </section>

      <section
        className={`refund-proof-guide refund-proof-guide-${guide.action}`}
        aria-label={guide.accessibleName}
        aria-live="polite"
        aria-atomic="false"
        data-next-action={guide.action}
      >
        <div className="refund-proof-guide-next">
          <small>{guide.progress}</small>
          <strong>{guide.actorLabel}</strong>
        </div>
        <div className="refund-proof-guide-message">
          <h3>{guide.title}</h3>
          <p>{guide.description}</p>
          <small>{guide.secondary}</small>
        </div>

        {guide.showPrompt &&
        registration.state === "ready" &&
        stagingTarget.state === "configured" ? (
          <div className="refund-proof-prompt" aria-label="Agent prompt">
            <span>{guide.promptLabel}</span>
            <div className="refund-proof-prompt-body">
              <p>{guide.promptSummary}</p>
              <details>
                <summary>View exact WebMCP instructions</summary>
                <code>{prompt}</code>
              </details>
            </div>
            {guide.canCopyPrompt ? (
              <button
                className="refund-proof-copy-button"
                type="button"
                onClick={() => void copyPrompt()}
              >
                {copyState === "copied"
                  ? "Copied"
                  : copyState === "failed"
                    ? "Try copy again"
                    : "Copy agent instruction"}
              </button>
            ) : null}
            {guide.canCopyPrompt && copyState !== "idle" ? (
              <span
                className="visually-hidden"
                role="status"
                aria-label={copyState === "copied" ? "Prompt copied" : "Prompt copy failed"}
              >
                {copyState === "copied"
                  ? "Prompt copied to clipboard."
                  : "Prompt could not be copied. Select the prompt text instead."}
              </span>
            ) : null}
          </div>
        ) : guide.showPrompt &&
          !(simulationActive && stagingTarget.state === "configured") ? (
          <div className="refund-proof-prompt refund-proof-prompt-unavailable" aria-label="Agent prompt unavailable">
            <span>{registrationPresentation.promptTitle}</span>
            <p>{registrationPresentation.promptDescription}</p>
          </div>
        ) : null}
      </section>

      {simulation && !simulationIsCompareOption ? (
        <RefundSimulationPanel simulation={simulation} />
      ) : null}

      <ol className="refund-proof-path" aria-label="Agent to outcome proof path">
        {PATH_STAGES.map((stage, index) => {
          const state = pathStageState(
            view,
            index,
            guide.action === "enable-webmcp" ||
              guide.action === "configure-target" ||
              guide.action === "reload",
          );
          return (
            <li
              key={stage.label}
              className={`refund-proof-path-${state}`}
              aria-current={state === "current" ? "step" : undefined}
            >
              <span className="refund-proof-path-index" aria-hidden="true">
                {state === "complete" ? "✓" : String(index + 1).padStart(2, "0")}
              </span>
              <span>
                <strong>{stage.label}</strong>
                <small>{stage.detail}</small>
              </span>
              <span className="visually-hidden">{pathStateLabel(state)}</span>
            </li>
          );
        })}
      </ol>

      <section
        className={`refund-proof-approval ${approvalPending ? "refund-proof-approval-pending" : ""} ${approvalCollapsed ? "refund-proof-collapsed" : ""}`}
        aria-labelledby="refund-proof-approval-title"
        ref={approvalRegionRef}
        tabIndex={-1}
      >
        <div className="refund-proof-approval-heading">
          <span className="refund-proof-panel-label">Human checkpoint</span>
          <h3 id="refund-proof-approval-title">
            {trial ? "Exact staging refund fixture" : "Waiting for the agent to reset a staging trial"}
          </h3>
          <p>
            {trial
              ? "Approval is bound to these values. If anything changes, it has to be approved again."
              : "No target call is allowed until a person reviews the exact staging fixture."}
          </p>
          {trial ? (
            <details className="refund-proof-approval-binding">
              <summary>Show binding details</summary>
              <dl>
                <div><dt>Epoch</dt><dd><code>{trial.ref.epoch}</code></dd></div>
                <div><dt>Approval digest</dt><dd><code>{trial.ref.digest}</code></dd></div>
              </dl>
            </details>
          ) : null}
        </div>

        {pastApproval && trial ? (
          <p className="refund-proof-approval-summary">
            <span aria-hidden="true">✓</span>
            <strong>Approved</strong>
            <span aria-hidden="true">·</span>
            <code>{trial.paymentId}</code>
            <span aria-hidden="true">·</span>
            {(trial.amountMinor / 100).toFixed(2)} {trial.currency}
            <span aria-hidden="true">·</span>
            <code>{trial.requestId}</code>
          </p>
        ) : (
          <dl className="refund-proof-trial-data">
            <div>
              <dt>Trial ID</dt>
              <dd><code>{trial?.ref.trialId ?? "Not staged"}</code></dd>
            </div>
            <div>
              <dt>Payment</dt>
              <dd><code>{trial?.paymentId ?? "Not staged"}</code></dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>{trial ? `${(trial.amountMinor / 100).toFixed(2)} ${trial.currency}` : "Not staged"}</dd>
            </div>
            <div>
              <dt>Request ID</dt>
              <dd><code>{trial?.requestId ?? "Not staged"}</code></dd>
            </div>
            <div>
              <dt>Approval</dt>
              <dd className={approvalPending ? "refund-proof-value-pending" : trial?.approvalStatus === "approved" ? "refund-proof-value-ready" : ""}>
                {approvalLabel}
              </dd>
            </div>
          </dl>
        )}

        {approvalPending && trial ? (
          <button
            className="refund-proof-approve"
            type="button"
            ref={approvalButtonRef}
            disabled={approving}
            onClick={() => void approve()}
          >
            <span aria-hidden="true">{approving ? "···" : "✓"}</span>
            {approving ? "Approving exact trial…" : "Approve exact staging refund"}
          </button>
        ) : null}
        <p className="refund-proof-approval-error" role="alert">
          {approvalError}
        </p>
      </section>

      {pastApproval ? (
        <div className="refund-proof-lanes" aria-label="Refund retry comparison">
          <RefundLanePanel lane="broken" view={view.lanes.broken} proofReady={view.proof !== null} />
          <RefundLanePanel lane="protected" view={view.lanes.protected} proofReady={view.proof !== null} />
        </div>
      ) : null}

      {view.phase === "proof_ready" && view.proof ? (
        <section
          className="refund-proof-result"
          aria-labelledby="refund-proof-result-title"
          ref={proofRegionRef}
          tabIndex={-1}
        >
          <span className="refund-proof-result-mark" aria-hidden="true">✓</span>
          <div>
            <span className="refund-proof-panel-label">Checker validated</span>
            <h3 id="refund-proof-result-title">Caught the unsafe duplicate. Protected stayed single.</h3>
          </div>
          <dl>
            <div className="refund-proof-result-broken">
              <dt>Known-bad</dt>
              <dd>{view.proof.broken.attempts} calls → {view.proof.broken.providerRefunds} effects</dd>
            </div>
            <div className="refund-proof-result-protected">
              <dt>Protected</dt>
              <dd>{view.proof.protected.attempts} calls → {view.proof.protected.providerRefunds} effect</dd>
            </div>
          </dl>
          <small>Evidence: {view.proof.evidenceSource}</small>
          {simulationActive ? (
            <p className="refund-proof-simulation-footnote">
              <span aria-hidden="true">SIM</span>
              <span className="refund-proof-simulation-footnote-text">
                WebMCP discovery was not exercised in this run. A simulated agent called
                stage_refund_comparison, issue_refund, and prove_refund_comparison directly
                in-page — not through <code>document.modelContext</code>.
              </span>
            </p>
          ) : null}
          <details className="refund-proof-receipt-binding">
            <summary>Show approval and effect binding</summary>
            <dl>
              <div><dt>Trial digest</dt><dd><code>{view.proof.trialRef.digest}</code></dd></div>
              <div><dt>Request ID</dt><dd><code>{view.proof.requestId}</code></dd></div>
              <div><dt>Known-bad effects</dt><dd><code>{view.proof.broken.effectIds.join(", ")}</code></dd></div>
              <div><dt>Protected effect</dt><dd><code>{view.proof.protected.effectIds[0]}</code></dd></div>
              <div><dt>Staging target</dt><dd><code>{view.proof.deploymentId}</code></dd></div>
            </dl>
          </details>
        </section>
      ) : null}

      {simulation && simulationIsCompareOption ? (
        <RefundSimulationPanel simulation={simulation} />
      ) : null}

      <footer className="refund-proof-disclosure">
        <span aria-hidden="true">STG</span>
        <p><strong>Staging sandbox only.</strong> No payment account is connected and no real money moves.</p>
      </footer>
    </section>
  );
}

type RefundWorkflowGuide = Readonly<{
  accessibleName: "Next actor: Agent" | "Next actor: Human" | "Workflow complete" | "Workflow blocked";
  action:
    | "stage"
    | "approve"
    | "deliver"
    | "retry"
    | "prove"
    | "complete"
    | "enable-webmcp"
    | "configure-target"
    | "reload";
  progress: string;
  actorLabel: string;
  title: string;
  description: string;
  secondary: string;
  promptLabel: string;
  promptSummary: string;
  showPrompt: boolean;
  canCopyPrompt: boolean;
}>;

function refundWorkflowGuide(
  view: RefundComparisonView,
  registration: RefundProofRegistration,
  stagingTarget: RefundStagingTargetStatus,
  simulationActive: boolean,
): RefundWorkflowGuide {
  const callsComplete = view.lanes.broken.attempts + view.lanes.protected.attempts;
  const allDeliveriesComplete =
    view.lanes.broken.attempts === 2 && view.lanes.protected.attempts === 2;
  const recoveryRequired =
    view.lanes.broken.recovery === "reset_required" ||
    view.lanes.protected.recovery === "reset_required";
  const retryRequired =
    view.lanes.broken.attempts === 1 || view.lanes.protected.attempts === 1;

  if (view.phase === "proof_ready") {
    return {
      accessibleName: "Workflow complete",
      action: "complete",
      progress: "Complete",
      actorLabel: "Proof ready",
      title: "Unsafe created 2 refunds. Protected created 1.",
      description: "Verdict from the ledger, not the tool reply. The bound result is below.",
      secondary: "",
      promptLabel: "",
      promptSummary: "",
      showPrompt: false,
      canCopyPrompt: false,
    };
  }

  if (view.phase === "awaiting_approval") {
    return {
      accessibleName: "Next actor: Human",
      action: "approve",
      progress: "Step 2 of 4",
      actorLabel: "Next — You",
      title: "Staging reset passed — approve the $42 request",
      description: "Check the payment, amount, and request ID. This button is not a tool: an agent cannot press it.",
      secondary: "Agent is waiting",
      promptLabel: "Agent is waiting",
      promptSummary: "After approving, tell your agent to continue.",
      showPrompt: true,
      canCopyPrompt: false,
    };
  }

  if (view.phase === "closed") {
    return {
      accessibleName: "Workflow blocked",
      action: "reload",
      progress: "Session closed",
      actorLabel: "Blocked",
      title: "Reload this page to start another trial",
      description: "The previous browser-local session has ended and cannot accept more tool calls.",
      secondary: "No real payment was connected.",
      promptLabel: "",
      promptSummary: "",
      showPrompt: false,
      canCopyPrompt: false,
    };
  }

  if (stagingTarget.state === "missing") {
    return {
      accessibleName: "Workflow blocked",
      action: "configure-target",
      progress: "Setup needed",
      actorLabel: "Blocked",
      title: "Connect the external staging target",
      description:
        "The WebMCP tools are registered, but this deployment has no external ledger to reset, invoke, or observe.",
      secondary: "Set the public staging target URL, redeploy, and confirm this status turns ready.",
      promptLabel: "Agent prompt unavailable",
      promptSummary: "The agent path stays blocked until the staging target is configured.",
      showPrompt: true,
      canCopyPrompt: false,
    };
  }

  if (registration.state !== "ready" && !simulationActive) {
    return {
      accessibleName: "Workflow blocked",
      action: "enable-webmcp",
      progress: "Native path",
      actorLabel: "Not in this browser",
      title: "Run the same check with a simulated agent, or open a WebMCP browser",
      description: "This browser has no WebMCP client. The simulated agent below runs the same four steps against the real staging target; every result is labelled as simulated.",
      secondary: "",
      promptLabel: "",
      promptSummary: "",
      showPrompt: true,
      canCopyPrompt: false,
    };
  }

  if (view.phase === "idle") {
    return {
      accessibleName: "Next actor: Agent",
      action: "stage",
      progress: "Step 1 of 4",
      actorLabel: "Next — Agent",
      title: "Send this instruction to your agent",
      description: "The agent stages a fictional refund and stops for your approval.",
      secondary: "",
      promptLabel: "Agent instruction",
      promptSummary: "Stage the refund comparison on this page and stop for my approval.",
      showPrompt: true,
      canCopyPrompt: true,
    };
  }

  if (recoveryRequired) {
    return {
      accessibleName: "Workflow blocked",
      action: "stage",
      progress: "Fresh trial required",
      actorLabel: "Blocked",
      title: "Outcome evidence did not match — reset the trial",
      description:
        "This lane is locked because Action Check could not bind the last response to the expected ledger change.",
      secondary: "Ask the agent to stage a fresh comparison. Do not retry the locked lane.",
      promptLabel: "Agent instruction",
      promptSummary: "Reset both staging lanes and wait for a new human approval.",
      showPrompt: true,
      canCopyPrompt: true,
    };
  }

  if (allDeliveriesComplete) {
    return {
      accessibleName: "Next actor: Agent",
      action: "prove",
      progress: "Step 4 of 4",
      actorLabel: "Next — Agent",
      title: "Verify the outcome",
      description: "Both lanes ran twice. The agent calls prove_refund_comparison; no further refund calls.",
      secondary: "",
      promptLabel: "Agent instruction",
      promptSummary: "Call prove_refund_comparison now. Do not call issue_refund again.",
      showPrompt: true,
      canCopyPrompt: true,
    };
  }

  if (retryRequired) {
    return {
      accessibleName: "Next actor: Agent",
      action: "retry",
      progress: `Step 3 of 4 · ${callsComplete}/4 calls`,
      actorLabel: "Next — Agent",
      title: "Retry with the same request ID",
      description: "The refund committed but the acknowledgement was lost. The agent repeats that lane once, same request ID.",
      secondary: "",
      promptLabel: "Agent instruction",
      promptSummary: "Retry the lost acknowledgement once, using the exact same approved values.",
      showPrompt: true,
      canCopyPrompt: true,
    };
  }

  if (callsComplete > 0) {
    return {
      accessibleName: "Next actor: Agent",
      action: "deliver",
      progress: `Step 3 of 4 · ${callsComplete}/4 calls`,
      actorLabel: "Next — Agent",
      title: "Run the remaining version",
      description: "One lane is complete. The agent runs the other lane with the same approved values.",
      secondary: "",
      promptLabel: "Agent instruction",
      promptSummary: "Run only the incomplete lane; completed deliveries must not be repeated.",
      showPrompt: true,
      canCopyPrompt: true,
    };
  }

  return {
    accessibleName: "Next actor: Agent",
    action: "deliver",
    progress: "Step 3 of 4 · 0/4 calls",
    actorLabel: "Next — Agent",
    title: "Return to your agent and say continue",
    description: "Approval does not wake the chat. The agent now runs both lanes, twice each, same request ID.",
    secondary: "",
    promptLabel: "Agent instruction",
    promptSummary: "Continue with the approved refund test and run both retry versions.",
    showPrompt: true,
    canCopyPrompt: true,
  };
}

/**
 * Relabels the "next actor" guide when a simulated agent — not a person
 * copying a prompt to an external agent — is driving the remaining steps,
 * and hides the copy-a-prompt affordance since there is nothing to copy:
 * the simulated driver calls the session directly. Leaves the human
 * approval step's guide untouched; that step is real regardless of mode.
 */
function withSimulatedActor(guide: RefundWorkflowGuide): RefundWorkflowGuide {
  if (guide.actorLabel !== "Next — Agent") return guide;
  return {
    ...guide,
    actorLabel: "Next — Simulated agent",
    showPrompt: false,
    canCopyPrompt: false,
  };
}

function nativeRegistrationPresentation(
  registration: RefundProofRegistration,
  stagingTarget: RefundStagingTargetStatus,
): Readonly<{
  kicker: string;
  description: string;
  promptTitle: string;
  promptDescription: string;
  toolStateLabel: string;
  registeredToolsLabel: string;
}> {
  const state = registration.state;
  switch (state) {
    case "ready":
      if (stagingTarget.state === "missing") {
        return {
          kicker: "Native WebMCP ready · external target missing",
          description:
            "The browser registered the three agent tools, but this deployment cannot produce outcome proof until its staging ledger is configured.",
          promptTitle: "External target unavailable",
          promptDescription:
            "Configure the external staging target before asking an agent to start the refund comparison.",
          toolStateLabel: "Ready",
          registeredToolsLabel: `${REFUND_COMPARISON_TOOL_NAMES.length} registered tools`,
        };
      }
      return {
        kicker: "Refund · same request ID · retried once",
        description:
          "The agent retries the same staging refund through WebMCP. Action Check reads the ledger separately and catches the unsafe duplicate.",
        promptTitle: "Agent prompt ready",
        promptDescription: "The three native tools are ready for the exact agent prompt.",
        toolStateLabel: "Ready",
        registeredToolsLabel: `${REFUND_COMPARISON_TOOL_NAMES.length} registered tools`,
      };
    case "registering":
      return {
        kicker: "Native WebMCP · registering three tools",
        description:
          "The browser is registering the staging refund workflow. No agent call is available until registration completes.",
        promptTitle: "Agent prompt waiting",
        promptDescription:
          "Wait for all three WebMCP tools to register before giving the agent instructions.",
        toolStateLabel: "Registering",
        registeredToolsLabel: registration.label,
      };
    case "failed":
      return {
        kicker: "Native WebMCP · registration failed",
        description:
          "The three-tool WebMCP surface did not register, so this browser cannot run the agent path yet.",
        promptTitle: "Agent prompt unavailable",
        promptDescription:
          "Reload after WebMCP is enabled and confirm that native registration succeeds.",
        toolStateLabel: "Failed",
        registeredToolsLabel: "0 registered tools",
      };
    case "unavailable":
      return {
        kicker: "Native WebMCP · unavailable in this browser",
        description:
          "This browser cannot register the three-tool agent path. The UI-only synthetic suite below remains available.",
        promptTitle: "Agent prompt unavailable",
        promptDescription:
          "Open this page in a WebMCP-capable top-level browser to run the native agent path.",
        toolStateLabel: "Unavailable",
        registeredToolsLabel: "0 registered tools",
      };
    default:
      return assertNever(state);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled registration state: ${String(value)}`);
}

function agentPrompt(view: RefundComparisonView): string {
  const trial = view.trial ?? FIXED_TRIAL;
  const recoveryRequired =
    view.lanes.broken.recovery === "reset_required" ||
    view.lanes.protected.recovery === "reset_required";
  const startsFreshTrial =
    view.phase === "idle" ||
    view.phase === "proof_ready" ||
    view.phase === "closed" ||
    recoveryRequired;
  const exactArguments =
    `paymentId "${trial.paymentId}", amountMinor ${trial.amountMinor}, ` +
    `currency "${trial.currency}", and requestId "${trial.requestId}"`;
  const laneSteps = (["broken", "protected"] as const)
    .map((lane) =>
      lanePrompt(
        lane,
        startsFreshTrial ? 0 : view.lanes[lane].attempts,
        exactArguments,
      ),
    )
    .join(" ");
  const stageStep =
    startsFreshTrial
      ? "Call stage_refund_comparison with {}. Wait until I approve the exact trial shown on the page. "
      : view.phase === "awaiting_approval"
        ? "Wait until I approve the exact staged trial shown on the page. "
        : "";

  return `${stageStep}${laneSteps} Then call prove_refund_comparison with {}.`;
}

function lanePrompt(
  lane: RefundLane,
  attempts: number,
  exactArguments: string,
): string {
  if (attempts === 0) {
    return (
      `Call issue_refund twice for lane "${lane}" using ${exactArguments}. ` +
      "The first call is expected to return PROVIDER_ACK_LOST_AFTER_COMMIT after the staging commit; retry once with identical arguments."
    );
  }
  if (attempts === 1) {
    return `Retry issue_refund once for lane "${lane}" using identical ${exactArguments}.`;
  }
  return `Do not call issue_refund again for lane "${lane}"; its two approved deliveries are complete.`;
}

function RefundLanePanel({
  lane,
  view,
  proofReady,
}: {
  lane: RefundLane;
  view: RefundLaneView;
  proofReady: boolean;
}) {
  const isBroken = lane === "broken";
  const status = laneStatus(lane, view, proofReady);

  return (
    <section
      className={`refund-proof-lane refund-proof-lane-${lane}`}
      aria-labelledby={`refund-proof-lane-${lane}-title`}
    >
      <header>
        <div>
          <span className="refund-proof-panel-label">{isBroken ? "Known-bad staging target" : "Protected staging target"}</span>
          <h3 id={`refund-proof-lane-${lane}-title`}>
            {isBroken ? "Unsafe retry" : "Protected retry"}
          </h3>
        </div>
        <span className="refund-proof-lane-status">{status}</span>
      </header>
      <code className="refund-proof-target-name">issue_refund({`{ lane: "${lane}" }`})</code>
      <dl className="refund-proof-lane-metrics">
        <div>
          <dt>Tool calls</dt>
          <dd>{view.attempts}</dd>
        </div>
        <div>
          <dt>Refunds created</dt>
          <dd>{view.providerRefunds}</dd>
        </div>
        <div>
          <dt>Observed state</dt>
          <dd>{formatFinalState(view.finalState)}</dd>
        </div>
      </dl>
      <p>
        <span>Tool response</span>
        <strong>{formatClaim(view.lastClaim)}</strong>
      </p>
    </section>
  );
}

function pathStageState(
  view: RefundComparisonView,
  index: number,
  blocked: boolean,
): "complete" | "current" | "waiting" {
  if (blocked) return "waiting";
  const currentIndex =
    view.phase === "idle"
      ? 0
      : view.phase === "awaiting_approval"
        ? 1
        : view.phase === "approved" || view.phase === "running"
          ? view.lanes.broken.attempts === 2 && view.lanes.protected.attempts === 2
            ? 3
            : 2
          : view.phase === "proof_ready"
            ? 4
            : -1;
  if (index < currentIndex) return "complete";
  if (index === currentIndex && currentIndex < PATH_STAGES.length) return "current";
  return "waiting";
}

function pathStateLabel(state: "complete" | "current" | "waiting"): string {
  if (state === "complete") return "Complete";
  if (state === "current") return "Current stage";
  return "Waiting";
}

function laneStatus(
  lane: RefundLane,
  view: RefundLaneView,
  proofReady: boolean,
): string {
  if (view.recovery === "reset_required") return "Fresh trial required";
  if (proofReady) return lane === "broken" ? "Fail (expected)" : "Pass";
  if (view.attempts === 0) return "Not run";
  if (view.attempts === 1) return "Ack uncertain";
  return lane === "broken" ? "Duplicate observed" : "Retry reused";
}

function formatFinalState(state: RefundLaneView["finalState"]): string {
  if (state === "refunded_once") return "Refunded once";
  if (state === "refunded_twice") return "Refunded twice";
  return "Not run";
}

function formatClaim(claim: RefundLaneView["lastClaim"]): string {
  if (claim === "provider_ack_lost") {
    return "Staging commit; acknowledgement uncertain";
  }
  if (claim === "created") return "Target claims a new refund";
  if (claim === "reused") return "Target claims the refund was reused";
  return "No response yet";
}

function simulationBadgeCopy(registration: RefundProofRegistration): string {
  return registration.state === "ready"
    ? "Simulated agent · WebMCP not used for this run · tools called in-page"
    : "Simulated agent · no WebMCP client connected · tools called in-page";
}

function simulationLauncherLabel(status: RefundProofSimulationRunStatus): string {
  switch (status) {
    case "idle":
      return "Run with a simulated agent";
    case "running":
      return "Simulated agent running…";
    case "awaiting_human_approval":
      return "Waiting for your approval…";
    case "complete":
      return "Run again";
    case "error":
      return "Retry simulated agent";
    default:
      return "Run with a simulated agent";
  }
}

function simulationStepStatusLabel(status: RefundProofSimulationStepStatus): string {
  switch (status) {
    case "pending":
      return "Not run";
    case "running":
      return "Running";
    case "ok":
      return "Done";
    case "error":
      return "Failed";
    default:
      return status;
  }
}

function RefundSimulationPanel({
  simulation,
}: {
  simulation: RefundProofSimulation;
}) {
  const busy =
    simulation.status === "running" || simulation.status === "awaiting_human_approval";
  const secondary = simulation.availableNatively;

  return (
    <section
      className={`refund-proof-simulation ${secondary ? "refund-proof-simulation-secondary" : "refund-proof-simulation-primary"}`}
      aria-label="Simulated agent path"
    >
      <div className="refund-proof-simulation-controls">
        <p>
          {secondary
            ? "Or run the same four steps with a simulated agent, labelled as simulated."
            : "No WebMCP in this browser. Run the same four steps with a simulated agent; every result is labelled as simulated."}
        </p>
        <button
          type="button"
          className={
            secondary
              ? "refund-proof-simulate-button-secondary"
              : "refund-proof-simulate-button-primary"
          }
          disabled={busy}
          onClick={simulation.onRun}
        >
          {simulationLauncherLabel(simulation.status)}
        </button>
      </div>

      {simulation.status !== "idle" ? (
        <ol className="refund-proof-simulation-trace" aria-label="Simulated agent event trace">
          {simulation.steps.map((step) => (
            <li key={step.id} className={`refund-proof-simulation-step-${step.status}`}>
              <span className="refund-proof-simulation-tag" aria-hidden="true">
                simulated
              </span>
              <span>
                <strong>{step.label}</strong>
                <small>
                  {simulationStepStatusLabel(step.status)}
                  {step.detail ? ` — ${step.detail}` : ""}
                </small>
              </span>
              <span className="visually-hidden">
                {`simulated step, ${simulationStepStatusLabel(step.status)}`}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {simulation.status === "error" && simulation.error ? (
        <p className="refund-proof-simulation-error" role="alert">
          {simulation.error}
        </p>
      ) : null}
    </section>
  );
}
