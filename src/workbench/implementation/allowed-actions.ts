import type {
  AgentCommand,
  HumanCommand,
  OAuthFinding,
  PatchView,
  ReceiptView,
  WorkbenchPhase,
} from "../interface";

export type AllowedNextActions = Readonly<{
  agent: readonly AgentCommand["kind"][];
  human: readonly HumanCommand["kind"][];
}>;

export function projectAllowedActions(input: {
  phase: WorkbenchPhase;
  findings: readonly OAuthFinding[];
  patch: PatchView | null;
  receipt: ReceiptView | null;
  closed: boolean;
}): AllowedNextActions {
  if (input.closed) {
    return { agent: [], human: [] };
  }

  const agent: AgentCommand["kind"][] = ["read_case"];
  const human: HumanCommand["kind"][] = ["reset"];

  if (input.phase === "case_loaded") {
    agent.push("run_diagnostics");
  }

  if (input.findings.length > 0) {
    agent.push("explain_finding");
  }

  if (
    input.findings.some((finding) => finding.repairAvailable) &&
    (input.phase === "diagnosed" || input.phase === "rejected" || input.phase === "replay_failed")
  ) {
    agent.push("stage_sandbox_fix");
  }

  if (input.phase === "approved") {
    agent.push("replay_flow");
  }

  if (input.receipt !== null && input.phase === "receipt_ready") {
    agent.push("prepare_report");
  }

  if (
    input.patch !== null &&
    (input.phase === "awaiting_human_approval" ||
      input.phase === "approved" ||
      input.phase === "rejected" ||
      input.phase === "replay_failed")
  ) {
    human.unshift("edit_patch");
    human.unshift("reject_patch");
  }

  if (input.patch !== null && input.phase === "awaiting_human_approval") {
    human.unshift("confirm_patch");
  }

  return {
    agent: Object.freeze(agent),
    human: Object.freeze(human),
  };
}
