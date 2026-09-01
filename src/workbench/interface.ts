export type WorkbenchPhase =
  | "case_loaded"
  | "diagnosed"
  | "fix_staged"
  | "awaiting_human_approval"
  | "approved"
  | "rejected"
  | "replaying"
  | "replay_failed"
  | "replay_succeeded"
  | "receipt_ready";

export type AgentCommand =
  | { readonly kind: "read_case" }
  | { readonly kind: "run_diagnostics" }
  | { readonly kind: "explain_finding"; readonly findingId: string }
  | { readonly kind: "stage_sandbox_fix"; readonly findingId: string }
  | { readonly kind: "replay_flow" }
  | { readonly kind: "prepare_report" };

export type PatchRef = Readonly<{
  caseId: string;
  sessionEpoch: number;
  patchId: string;
  version: number;
  digest: string;
}>;

export type HumanCommand =
  | { readonly kind: "edit_patch"; readonly expected: PatchRef; readonly after: string }
  | { readonly kind: "confirm_patch"; readonly expected: PatchRef }
  | { readonly kind: "reject_patch"; readonly expected: PatchRef }
  | { readonly kind: "reset"; readonly caseId?: string };

export type CommandKind = AgentCommand["kind"] | HumanCommand["kind"];
export type AllowedAction = CommandKind;

export type WorkbenchErrorCode =
  | "INVALID_INPUT"
  | "INVALID_PHASE"
  | "FINDING_NOT_FOUND"
  | "FINDING_HAS_NO_REPAIR"
  | "PATCH_REF_STALE"
  | "PATCH_VALUE_INVALID"
  | "HUMAN_APPROVAL_REQUIRED"
  | "APPROVAL_STALE"
  | "OPERATION_IN_PROGRESS"
  | "OPERATION_CANCELLED"
  | "REPORT_NOT_READY"
  | "OUTPUT_BUDGET_EXCEEDED"
  | "SESSION_CLOSED"
  | "INTERNAL_FAILURE";

export type SafeJsonValue =
  | string
  | number
  | boolean
  | null
  | SafeJsonObject
  | readonly SafeJsonValue[];

export interface SafeJsonObject {
  readonly [key: string]: SafeJsonValue;
}

export type WorkbenchError = Readonly<{
  code: WorkbenchErrorCode;
  message: string;
  nextAction: string;
}>;

export type SuccessfulOutcome = Readonly<{
  ok: true;
  command: CommandKind;
  phase: WorkbenchPhase;
  summary: string;
  data?: SafeJsonObject;
  allowedNextActions: readonly AllowedAction[];
}>;

export type FailedOutcome = Readonly<{
  ok: false;
  command: CommandKind;
  phase: WorkbenchPhase;
  error: WorkbenchError;
  allowedNextActions: readonly AllowedAction[];
}>;

export type Outcome = SuccessfulOutcome | FailedOutcome;

export type SafeCaseTimelineItem = Readonly<{
  id: string;
  label: string;
  status: "completed" | "blocked" | "pending";
  detail: string;
}>;

export type AssuranceScenarioKind =
  | "stale_approval"
  | "duplicate_effect"
  | "false_success"
  | "booking_state_drift"
  | "duplicate_refund"
  | "cloud_false_success"
  | "social_publish";

export type EffectFaultKind =
  | "state_drift"
  | "duplicate_delivery"
  | "false_success";

export type EffectContractView = Readonly<{
  effectId: string;
  target: string;
  readBefore: string;
  precondition: string;
  approvalBinding: string;
  idempotencyKey: string;
  execute: string;
  readAfter: string;
  postcondition: string;
  evidenceSource: string;
}>;

export type EffectTestProfile = Readonly<{
  industry: "Travel" | "Payments" | "Cloud" | "Social";
  toolName: string;
  intent: string;
  passingBehavior: string;
  passTitle: string;
  fault: Readonly<{
    kind: EffectFaultKind;
    label: string;
    description: string;
  }>;
  negativeControl: Readonly<{
    label: string;
    expectedFailure: string;
  }>;
  contract: EffectContractView;
}>;

export type SafeCaseSummaryItem = Readonly<{
  id: string;
  label: string;
  value: string;
  emphasis?: "neutral" | "danger" | "action" | "verified";
}>;

export type SafeAssuranceCase = Readonly<{
  id: string;
  kind: AssuranceScenarioKind;
  title: string;
  objective: string;
  synthetic: true;
  safetyNotice: string;
  summary: readonly SafeCaseSummaryItem[];
  timeline: readonly SafeCaseTimelineItem[];
  effectTest?: EffectTestProfile;
  providerName?: string;
  applicationName?: string;
  registeredRedirectUri?: string;
  observedRedirectUri?: string;
}>;

export type SafeOAuthCase = SafeAssuranceCase;

export type FindingEvidence = Readonly<{
  label: string;
  expected: string;
  observed: string;
}>;

export type AssuranceFinding = Readonly<{
  id: string;
  category:
    | "redirect_uri"
    | "duplicate_effect"
    | "false_success"
    | "state_drift"
    | "duplicate_refund"
    | "cloud_false_success"
    | "social_publish";
  severity: "blocking";
  title: string;
  summary: string;
  failedInvariant: string;
  evidence: readonly FindingEvidence[];
  smallestSafeCorrection: string;
  confidence: "high";
  requiresHumanApproval: true;
  repairAvailable: boolean;
}>;

export type OAuthFinding = AssuranceFinding;

export type PatchField =
  | "observed_redirect_uri"
  | "retry_policy"
  | "completion_policy"
  | "approval_binding";

export type PatchView = Readonly<{
  ref: PatchRef;
  findingId: string;
  field: PatchField;
  fieldLabel: string;
  before: string;
  after: string;
  approvalStatus: "pending" | "approved" | "rejected";
}>;

export type ReplayStepView = Readonly<{
  id: string;
  label: string;
  status: "pending" | "running" | "passed" | "failed";
  detail: string;
}>;

export type ReplayView = Readonly<{
  status: "idle" | "running" | "cancelled" | "failed" | "succeeded";
  steps: readonly ReplayStepView[];
  summary: string;
}>;

export type ReceiptView = Readonly<{
  id: string;
  format: "markdown";
  content: string;
  characterCount: number;
}>;

export type OutcomeProofMetric = Readonly<{
  label: string;
  value: string;
}>;

export type OutcomeProofView = Readonly<{
  status: "passed" | "failed";
  disposition:
    | "intended_outcome_verified"
    | "unsafe_outcome_prevented"
    | "false_success_detected"
    | "invariant_failed";
  businessOutcome: "achieved" | "not_achieved" | "unsafe";
  invariant: string;
  summary: string;
  metrics: readonly OutcomeProofMetric[];
  evidence: readonly FindingEvidence[];
}>;

export type AssuranceScenarioOption = Readonly<{
  id: string;
  kind: AssuranceScenarioKind;
  industry: EffectTestProfile["industry"];
  toolName: string;
  label: string;
  description: string;
}>;

export type WorkbenchView = Readonly<{
  sessionEpoch: number;
  sessionStatus: "open" | "closed";
  phase: WorkbenchPhase;
  case: SafeAssuranceCase;
  scenarioOptions: readonly AssuranceScenarioOption[];
  judgment: AssuranceFinding | null;
  findings: readonly AssuranceFinding[];
  patch: PatchView | null;
  replay: ReplayView;
  proof: OutcomeProofView | null;
  receipt: ReceiptView | null;
  allowedNextActions: Readonly<{
    agent: readonly AgentCommand["kind"][];
    human: readonly HumanCommand["kind"][];
  }>;
}>;

export type ExecuteOptions = Readonly<{ signal?: AbortSignal }>;

export interface WorkbenchAgent {
  execute(command: AgentCommand, options?: ExecuteOptions): Promise<Outcome>;
}

export interface WorkbenchHuman {
  execute(command: HumanCommand, options?: ExecuteOptions): Promise<Outcome>;
}

export interface WorkbenchObserver {
  getSnapshot(): WorkbenchView;
  subscribe(listener: () => void): () => void;
}

export interface AssuranceWorkbenchSession {
  readonly observe: WorkbenchObserver;
  readonly agent: WorkbenchAgent;
  readonly human: WorkbenchHuman;
  close(): void;
}

export type OAuthWorkbenchSession = AssuranceWorkbenchSession;
