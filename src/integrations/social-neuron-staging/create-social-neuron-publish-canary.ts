import type {
  CanaryAttestation,
  CanaryPreparation,
  CanaryTrial,
  CanaryTrialProof,
  ExpectedCanaryIdentity,
  NonPassingCanaryReport,
  PublishClaim,
  PublishObservation,
  SocialNeuronPublishCanary,
  SocialNeuronStagingPort,
} from "./interface.ts";

type CanaryConfig = Readonly<{
  port: SocialNeuronStagingPort;
  expectedIdentity: ExpectedCanaryIdentity;
  createId?: () => string;
  now?: () => number;
}>;

const MAX_LEASE_MS = 10 * 60 * 1_000;

type TrialResult =
  | Readonly<{ ok: true; proof: CanaryTrialProof }>
  | Readonly<{
      ok: false;
      status: NonPassingCanaryReport["status"];
      reason: NonPassingCanaryReport["reason"];
      cleanup: NonPassingCanaryReport["cleanup"];
    }>;

export function createSocialNeuronPublishCanary(
  config: CanaryConfig,
): SocialNeuronPublishCanary {
  const createId = config.createId ?? (() => crypto.randomUUID());
  const now = config.now ?? Date.now;

  return Object.freeze({
    async run(options: { requestId?: string; signal?: AbortSignal } = {}) {
      options.signal?.throwIfAborted();

      let attestation: CanaryAttestation;
      try {
        attestation = await config.port.attest(options);
      } catch (error: unknown) {
        rethrowCallerAbort(error, options.signal);
        return nonPassing("blocked", "REMOTE_FAILURE", false, "not_needed");
      }

      const identityFailure = validateCanaryIdentity(
        attestation,
        config.expectedIdentity,
      );
      if (identityFailure) {
        return nonPassing("blocked", identityFailure, false, "not_needed");
      }

      const suiteId = options.requestId ?? createId();
      const falseSuccess = await runTrial(
        config.port,
        "false_success",
        `${suiteId}-false_success`,
        options,
        now,
        attestation.attestationDigest,
      );
      if (!falseSuccess.ok) {
        return nonPassing(
          falseSuccess.status,
          falseSuccess.reason,
          true,
          falseSuccess.cleanup,
        );
      }

      const truthful = await runTrial(
        config.port,
        "truthful_success",
        `${suiteId}-truthful_success`,
        options,
        now,
        attestation.attestationDigest,
      );
      if (!truthful.ok) {
        return nonPassing(
          truthful.status,
          truthful.reason,
          true,
          truthful.cleanup,
        );
      }

      if (
        falseSuccess.proof.claim !== "published" ||
        falseSuccess.proof.authoritativeState === "published"
      ) {
        return nonPassing(
          "inconclusive",
          "FAULT_NOT_EXERCISED",
          true,
          "completed",
        );
      }
      if (
        falseSuccess.proof.judgment !== "rejected" ||
        truthful.proof.judgment !== "accepted"
      ) {
        return nonPassing(
          "failed",
          "INVARIANT_FAILED",
          true,
          "completed",
        );
      }

      return Object.freeze({
        status: "passed" as const,
        verdict: "false_success_caught" as const,
        environment: "staging" as const,
        deploymentId: attestation.deploymentId,
        trials: Object.freeze({
          falseSuccess: falseSuccess.proof,
          truthful: truthful.proof,
        }),
        sensitivity: Object.freeze({
          status: "passed" as const,
          mutant: "trust_handler_claim" as const,
        }),
        cleanup: "completed" as const,
      });
    },
  });
}

async function runTrial(
  port: SocialNeuronStagingPort,
  trial: CanaryTrial,
  requestId: string,
  options: { signal?: AbortSignal },
  now: () => number,
  attestationDigest: string,
): Promise<TrialResult> {
  let preparation: CanaryPreparation | null = null;
  let result: TrialResult | null = null;
  let thrown: unknown;

  try {
    options.signal?.throwIfAborted();
    preparation = await port.prepare(trial, requestId, options);
    if (!validPreparation(preparation, trial, now(), attestationDigest)) {
      result = trialFailure("inconclusive", "EVIDENCE_INCOMPLETE");
    } else {
      const before = await port.read(preparation, options);
      if (!completeObservation(before, preparation)) {
        result = trialFailure("inconclusive", "EVIDENCE_INCOMPLETE");
      } else if (!validPrecondition(before)) {
        result = trialFailure("inconclusive", "PRECONDITION_FAILED");
      } else {
        const claim = await port.execute(preparation, requestId, options);
        const after = await port.read(preparation, options);
        if (
          !validClaim(claim, preparation, requestId) ||
          !completeObservation(after, preparation) ||
          after.sequence <= before.sequence ||
          after.post.version === before.post.version ||
          after.evidence.digest === before.evidence.digest ||
          Date.parse(after.evidence.observedAt) <
            Date.parse(before.evidence.observedAt)
        ) {
          result = trialFailure("inconclusive", "EVIDENCE_INCOMPLETE");
        } else {
          result = evaluateTrial(trial, preparation, before, claim, after);
        }
      }
    }
  } catch (error: unknown) {
    thrown = error;
  }

  if (preparation) {
    try {
      await port.cleanup(preparation);
    } catch {
      return trialFailure("blocked", "CLEANUP_FAILED", "failed");
    }
  }

  if (thrown !== undefined) {
    rethrowCallerAbort(thrown, options.signal);
    return trialFailure("blocked", "REMOTE_FAILURE");
  }

  return result ?? trialFailure("blocked", "REMOTE_FAILURE");
}

function evaluateTrial(
  trial: CanaryTrial,
  preparation: CanaryPreparation,
  before: PublishObservation,
  claim: PublishClaim,
  after: PublishObservation,
): TrialResult {
  const authoritativePublished =
    after.post.status === "posted" &&
    after.post.externalIdPresent &&
    after.post.publishedAtPresent &&
    after.job.status === "completed" &&
    after.sink.status === "published" &&
    after.sink.deliveryCount === 1 &&
    after.sink.receiptPresent;
  const claimPublished = claim.status === "published";
  const judgment =
    claimPublished && authoritativePublished ? "accepted" : "rejected";

  if (trial === "false_success") {
    const falseSuccessExercised =
      claimPublished &&
      !authoritativePublished &&
      after.post.status === "posted" &&
      after.job.status === "completed" &&
      after.sink.status === "draft" &&
      after.sink.deliveryCount === 0 &&
      !after.sink.receiptPresent;
    if (!falseSuccessExercised) {
      return trialFailure("inconclusive", "FAULT_NOT_EXERCISED");
    }
  } else if (!claimPublished || !authoritativePublished) {
    return trialFailure("failed", "INVARIANT_FAILED");
  }

  return {
    ok: true,
    proof: Object.freeze({
      runId: preparation.runId,
      claim: claim.status,
      authoritativeState: after.sink.status,
      judgment,
      beforeEvidence: before.evidence.digest,
      afterEvidence: after.evidence.digest,
    }),
  };
}

export function validateCanaryIdentity(
  actual: CanaryAttestation,
  expected: ExpectedCanaryIdentity,
): NonPassingCanaryReport["reason"] | null {
  if (actual.environment !== "staging") return "WRONG_ENVIRONMENT";
  if (!actual.canaryEnabled) return "CANARY_DISABLED";
  if (!nonEmpty(actual.attestationDigest)) return "IDENTITY_MISMATCH";

  const keys = [
    "service",
    "deploymentId",
    "commitSha",
    "origin",
    "projectAlias",
    "accountAlias",
    "capability",
    "databaseIsolation",
    "providerMode",
    "liveProviderCredentialsPresent",
    "liveProviderEgressEnabled",
    "workerMode",
  ] as const;
  return keys.some((key) => actual[key] !== expected[key])
    ? "IDENTITY_MISMATCH"
    : null;
}

function validPreparation(
  preparation: CanaryPreparation,
  trial: CanaryTrial,
  now: number,
  attestationDigest: string,
): boolean {
  const leaseExpiry = Date.parse(preparation.leaseExpiresAt);
  return (
    preparation.trial === trial &&
    nonEmpty(preparation.runId) &&
    nonEmpty(preparation.fixtureAlias) &&
    Number.isFinite(leaseExpiry) &&
    leaseExpiry > now &&
    leaseExpiry - now <= MAX_LEASE_MS &&
    preparation.attestationDigest === attestationDigest
  );
}

function completeObservation(
  observation: PublishObservation,
  preparation: CanaryPreparation,
): boolean {
  return (
    observation.runId === preparation.runId &&
    observation.trial === preparation.trial &&
    Number.isSafeInteger(observation.sequence) &&
    observation.sequence >= 0 &&
    Number.isSafeInteger(observation.job.attemptCount) &&
    observation.job.attemptCount >= 0 &&
    Number.isSafeInteger(observation.sink.deliveryCount) &&
    observation.sink.deliveryCount >= 0 &&
    observation.evidence.source === "social-neuron-staging" &&
    observation.evidence.attestationDigest === preparation.attestationDigest &&
    nonEmpty(observation.post.version) &&
    Number.isFinite(Date.parse(observation.evidence.observedAt)) &&
    nonEmpty(observation.evidence.digest)
  );
}

function validPrecondition(observation: PublishObservation): boolean {
  return (
    observation.post.status === "approved" &&
    !observation.post.externalIdPresent &&
    !observation.post.publishedAtPresent &&
    observation.job.status === "ready" &&
    observation.job.attemptCount === 0 &&
    observation.sink.status === "draft" &&
    observation.sink.deliveryCount === 0 &&
    !observation.sink.receiptPresent
  );
}

function validClaim(
  claim: PublishClaim,
  preparation: CanaryPreparation,
  requestId: string,
): boolean {
  return (
    claim.runId === preparation.runId &&
    claim.trial === preparation.trial &&
    claim.requestId === requestId
  );
}

function nonPassing(
  status: NonPassingCanaryReport["status"],
  reason: NonPassingCanaryReport["reason"],
  mutationAttempted: boolean,
  cleanup: NonPassingCanaryReport["cleanup"],
): NonPassingCanaryReport {
  return Object.freeze({ status, reason, mutationAttempted, cleanup });
}

function trialFailure(
  status: NonPassingCanaryReport["status"],
  reason: NonPassingCanaryReport["reason"],
  cleanup: NonPassingCanaryReport["cleanup"] = "completed",
): TrialResult {
  return Object.freeze({ ok: false, status, reason, cleanup });
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function rethrowCallerAbort(
  error: unknown,
  signal: AbortSignal | undefined,
): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? error;
}
