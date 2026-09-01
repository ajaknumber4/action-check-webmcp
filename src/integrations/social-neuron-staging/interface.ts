export type CanaryEnvironment = "development" | "staging" | "production";

export type CanaryTrial = "false_success" | "truthful_success";

export type CanaryAttestation = Readonly<{
  service: "social-neuron";
  environment: CanaryEnvironment;
  deploymentId: string;
  commitSha: string;
  origin: string;
  projectAlias: string;
  accountAlias: string;
  capability: "publish-canary-v1";
  canaryEnabled: boolean;
  databaseIsolation: "isolated" | "shared";
  providerMode: "canary_sink" | "live_provider";
  liveProviderCredentialsPresent: boolean;
  liveProviderEgressEnabled: boolean;
  workerMode: "production_lifecycle" | "simulation";
  attestationDigest: string;
}>;

export type ExpectedCanaryIdentity = Readonly<
  Omit<
    CanaryAttestation,
    "environment" | "canaryEnabled" | "attestationDigest"
  > & {
    environment: "staging";
    canaryEnabled: true;
  }
>;

export type CanaryPreparation = Readonly<{
  runId: string;
  trial: CanaryTrial;
  fixtureAlias: string;
  leaseExpiresAt: string;
  attestationDigest: string;
}>;

export type PublishObservation = Readonly<{
  runId: string;
  trial: CanaryTrial;
  sequence: number;
  post: Readonly<{
    status: "approved" | "pending" | "posted" | "failed" | "cancelled";
    version: string;
    externalIdPresent: boolean;
    publishedAtPresent: boolean;
  }>;
  job: Readonly<{
    status: "ready" | "pending" | "processing" | "completed" | "failed";
    attemptCount: number;
  }>;
  sink: Readonly<{
    status: "draft" | "published";
    deliveryCount: number;
    receiptPresent: boolean;
  }>;
  evidence: Readonly<{
    source: "social-neuron-staging";
    attestationDigest: string;
    observedAt: string;
    digest: string;
  }>;
}>;

export type PublishClaim = Readonly<{
  runId: string;
  trial: CanaryTrial;
  requestId: string;
  status: "published" | "rejected";
  externalIdPresent: boolean;
}>;

export interface SocialNeuronStagingPort {
  attest(options?: { signal?: AbortSignal }): Promise<CanaryAttestation>;
  prepare(
    trial: CanaryTrial,
    requestId: string,
    options?: { signal?: AbortSignal },
  ): Promise<CanaryPreparation>;
  read(
    preparation: CanaryPreparation,
    options?: { signal?: AbortSignal },
  ): Promise<PublishObservation>;
  execute(
    preparation: CanaryPreparation,
    requestId: string,
    options?: { signal?: AbortSignal },
  ): Promise<PublishClaim>;
  cleanup(preparation: CanaryPreparation): Promise<void>;
}

export type CanaryTrialProof = Readonly<{
  runId: string;
  claim: PublishClaim["status"];
  authoritativeState: PublishObservation["sink"]["status"];
  judgment: "accepted" | "rejected";
  beforeEvidence: string;
  afterEvidence: string;
}>;

export type PassedCanaryReport = Readonly<{
  status: "passed";
  verdict: "false_success_caught";
  environment: "staging";
  deploymentId: string;
  trials: Readonly<{
    falseSuccess: CanaryTrialProof;
    truthful: CanaryTrialProof;
  }>;
  sensitivity: Readonly<{
    status: "passed";
    mutant: "trust_handler_claim";
  }>;
  cleanup: "completed";
}>;

export type NonPassingCanaryReport = Readonly<{
  status: "blocked" | "inconclusive" | "failed";
  reason:
    | "WRONG_ENVIRONMENT"
    | "IDENTITY_MISMATCH"
    | "CANARY_DISABLED"
    | "PRECONDITION_FAILED"
    | "FAULT_NOT_EXERCISED"
    | "EVIDENCE_INCOMPLETE"
    | "INVARIANT_FAILED"
    | "REMOTE_FAILURE"
    | "CLEANUP_FAILED";
  mutationAttempted: boolean;
  cleanup: "not_needed" | "completed" | "failed";
}>;

export type SocialNeuronCanaryReport =
  | PassedCanaryReport
  | NonPassingCanaryReport;

export interface SocialNeuronPublishCanary {
  run(options?: {
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<SocialNeuronCanaryReport>;
}
