import { useCallback, useEffect, useRef, useState } from "react";
import {
  detectBrowserModelContext,
  REFUND_COMPARISON_TOOL_NAMES,
  registerRefundComparisonTools,
  registerExternalTargetCanaryTool,
  type RefundComparisonToolRegistrationStatus,
} from "../adapters/webmcp";
import { useRefundComparisonView } from "../adapters/react/use-refund-comparison-view";
import { useSimulatedRefundComparisonRunner } from "../adapters/react/use-simulated-refund-comparison-runner";
import { useWorkbenchView } from "../adapters/react/use-workbench-view";
import { createSimulatedRefundComparisonRunner } from "../adapters/simulated-agent/run-simulated-refund-comparison";
import {
  BrowserExternalTargetCanaryClient,
  type BrowserCanaryReport,
} from "../integrations/external-target-staging";
import {
  HttpRefundEffectTarget,
  UnavailableRefundEffectTarget,
} from "../integrations/external-effect-staging";
import {
  createRefundComparisonSession,
  type RefundEffectTarget,
  type RefundTrialRef,
} from "../refund-comparison";
import { createInMemoryRefundEffectTarget } from "../refund-comparison/targets/in-memory-refund-effect-target";
import {
  createBrowserReplayScheduler,
  createAssuranceWorkbenchSession,
  DUPLICATE_REFUND_CASE_ID,
  type AgentCommand,
  type HumanCommand,
  type Outcome,
} from "../workbench";
import {
  WorkbenchPage,
  type ExternalTargetCanaryDisplay,
} from "./WorkbenchPage";
import type {
  RefundProofRegistration,
  RefundProofSimulation,
  RefundStagingTargetStatus,
} from "./RefundProofHero";

function initialRegistrationDisplay(): RefundProofRegistration {
  return {
    state: "registering",
    label: "Loading native WebMCP",
  };
}

export function App() {
  const [session] = useState(() =>
    createAssuranceWorkbenchSession({
      caseId: DUPLICATE_REFUND_CASE_ID,
      replayScheduler: createBrowserReplayScheduler(),
    }),
  );
  const view = useWorkbenchView(session.observe);
  const [refundTarget] = useState(createAppRefundTarget);
  const [refundComparison] = useState(() =>
    createRefundComparisonSession({ target: refundTarget.target }),
  );
  const refundComparisonView = useRefundComparisonView(refundComparison.observe);
  const [simulationRunner] = useState(() =>
    createSimulatedRefundComparisonRunner(refundComparison),
  );
  const simulationRunState = useSimulatedRefundComparisonRunner(simulationRunner);
  const [registration, setRegistration] = useState<RefundProofRegistration>(
    initialRegistrationDisplay,
  );
  const [externalTargetClient] = useState(
    () => new BrowserExternalTargetCanaryClient(),
  );
  const [externalTargetCanary, setExternalTargetCanary] =
    useState<ExternalTargetCanaryDisplay>({ state: "checking" });
  const externalTargetCanaryRef = useRef(externalTargetCanary);
  externalTargetCanaryRef.current = externalTargetCanary;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void externalTargetClient
      .probe({ signal: controller.signal })
      .then((availability) => {
        if (!active) return;
        setExternalTargetCanary(
          availability.state === "ready"
            ? {
                state: "ready",
                deploymentId: availability.deploymentId,
              }
            : { state: "blocked", reason: availability.reason },
        );
      })
      .catch(() => {
        if (active) {
          setExternalTargetCanary({
            state: "blocked",
            reason: "STAGING_REQUEST_FAILED",
          });
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [externalTargetClient]);

  useEffect(() => {
    const availability = detectBrowserModelContext();
    if (availability.state === "unavailable") {
      setRegistration({
        state: "unavailable",
        label: "Unavailable in this browser",
      });
      return;
    }

    const activeRegistration = registerRefundComparisonTools(
      refundComparison,
      availability.registrar,
    );
    const unsubscribe = activeRegistration.subscribe((status) => {
      setRegistration(toRegistrationDisplay(status));
    });
    void activeRegistration.ready.catch(() => {
      // The subscribed status carries the bounded, user-visible failure state.
    });

    return () => {
      unsubscribe();
      activeRegistration.dispose();
    };
  }, [refundComparison]);

  const executeExternalTargetCanary = useCallback(
    async (options: { signal?: AbortSignal } = {}): Promise<BrowserCanaryReport> => {
      const current = externalTargetCanaryRef.current;
      if (current.state === "checking" || current.state === "blocked") {
        return blockedCanaryReport("STAGING_NOT_CONFIGURED");
      }
      if (current.state === "running") {
        return blockedCanaryReport("CANARY_BUSY");
      }

      const deploymentId = current.deploymentId;
      setExternalTargetCanary({ state: "running", deploymentId });
      try {
        const report = await externalTargetClient.run(options);
        setExternalTargetCanary(toCanaryDisplay(report, deploymentId));
        return report;
      } catch (error: unknown) {
        setExternalTargetCanary({ state: "ready", deploymentId });
        throw error;
      }
    },
    [externalTargetClient],
  );

  const canExposeStagingTool =
    externalTargetCanary.state !== "checking" &&
    externalTargetCanary.state !== "blocked";

  useEffect(() => {
    if (!canExposeStagingTool) return;
    const availability = detectBrowserModelContext();
    if (availability.state === "unavailable") return;

    const canaryRegistration = registerExternalTargetCanaryTool(
      { run: executeExternalTargetCanary },
      availability.registrar,
    );
    void canaryRegistration.ready.catch(() => {
      // The three synthetic hero tools remain available if this optional tool fails.
    });
    return () => canaryRegistration.dispose();
  }, [canExposeStagingTool, executeExternalTargetCanary]);

  useEffect(() => {
    const closeOnPageExit = (event: PageTransitionEvent) => {
      if (!event.persisted) {
        session.close();
        refundComparison.close();
      }
    };
    window.addEventListener("pagehide", closeOnPageExit);
    return () => window.removeEventListener("pagehide", closeOnPageExit);
  }, [refundComparison, session]);

  const executeAgent = useCallback(
    (command: AgentCommand): Promise<Outcome> => session.agent.execute(command),
    [session],
  );
  const executeHuman = useCallback(
    (command: HumanCommand): Promise<Outcome> => session.human.execute(command),
    [session],
  );
  const runExternalTargetCanary = useCallback(async () => {
    await executeExternalTargetCanary();
  }, [executeExternalTargetCanary]);
  const approveRefundComparison = useCallback(
    async (expected: RefundTrialRef) => {
      const outcome = await refundComparison.human.approve(expected);
      if (!outcome.ok) throw new Error(outcome.error.message);
    },
    [refundComparison],
  );
  const runSimulatedRefundComparison = useCallback(() => {
    void simulationRunner.run();
  }, [simulationRunner]);

  const simulationOwnsCurrentTrial =
    simulationRunState.ownedEpoch !== null &&
    refundComparisonView.trial?.ref.epoch === simulationRunState.ownedEpoch;
  const refundComparisonSimulation: RefundProofSimulation = {
    availableNatively: registration.state === "ready",
    active: simulationOwnsCurrentTrial,
    status: simulationRunState.status,
    steps: simulationRunState.steps,
    error: simulationRunState.error,
    onRun: runSimulatedRefundComparison,
  };

  return (
    <WorkbenchPage
      view={view}
      refundComparison={refundComparisonView}
      registration={registration}
      stagingTarget={refundTarget.status}
      refundComparisonSimulation={refundComparisonSimulation}
      externalTargetCanary={externalTargetCanary}
      onRunExternalTargetCanary={runExternalTargetCanary}
      onApproveRefundComparison={approveRefundComparison}
      executeAgent={executeAgent}
      executeHuman={executeHuman}
    />
  );
}

function createAppRefundTarget(): Readonly<{
  target: RefundEffectTarget;
  status: RefundStagingTargetStatus;
}> {
  if (import.meta.env.MODE === "test") {
    return {
      target: createInMemoryRefundEffectTarget(),
      status: { state: "configured", label: "In-memory contract target" },
    };
  }
  const configured = import.meta.env.VITE_REFUND_STAGING_TARGET_URL?.trim();
  const loopback =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  const baseUrl = configured || (loopback ? "http://127.0.0.1:8787" : "");
  if (!baseUrl) {
    return {
      target: new UnavailableRefundEffectTarget(),
      status: { state: "missing", label: "Not configured" },
    };
  }
  try {
    return {
      target: new HttpRefundEffectTarget({ baseUrl }),
      status: {
        state: "configured",
        label: configured ? "Target URL configured" : "Local target configured",
      },
    };
  } catch {
    return {
      target: new UnavailableRefundEffectTarget(),
      status: { state: "missing", label: "Invalid target URL" },
    };
  }
}

function toCanaryDisplay(
  report: BrowserCanaryReport,
  fallbackDeploymentId: string,
): ExternalTargetCanaryDisplay {
  if (report.status === "passed") {
    return { state: "passed", deploymentId: report.deploymentId };
  }
  if (report.status === "failed" || report.status === "inconclusive") {
    return {
      state: report.status,
      deploymentId: fallbackDeploymentId,
      reason: report.reason,
    };
  }
  if (
    report.reason === "STAGING_NOT_CONFIGURED" ||
    report.reason === "STAGING_ATTESTATION_FAILED"
  ) {
    return { state: "blocked", reason: report.reason };
  }
  return {
    state: report.reason === "CLEANUP_FAILED" ? "failed" : "inconclusive",
    deploymentId: fallbackDeploymentId,
    reason: report.reason,
  };
}

function blockedCanaryReport(
  reason: "STAGING_NOT_CONFIGURED" | "CANARY_BUSY",
): BrowserCanaryReport {
  return {
    status: "blocked",
    reason,
    mutationAttempted: false,
    cleanup: "not_needed",
  };
}

function toRegistrationDisplay(
  status: RefundComparisonToolRegistrationStatus,
): RefundProofRegistration {
  switch (status.state) {
    case "registering":
      return {
        state: "registering",
        label: `Loading native tools ${status.registeredToolCount}/${REFUND_COMPARISON_TOOL_NAMES.length}`,
      };
    case "ready":
      return { state: "ready", label: "Native WebMCP ready" };
    case "failed":
      return { state: "failed", label: "Native WebMCP failed" };
    case "disposed":
      return { state: "unavailable", label: "Unavailable in this browser" };
  }
}
