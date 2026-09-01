import { describe, expect, it } from "vitest";

import {
  createSocialNeuronPublishCanary,
  type CanaryAttestation,
  type CanaryPreparation,
  type CanaryTrial,
  type PublishClaim,
  type PublishObservation,
  type SocialNeuronStagingPort,
} from "../src/integrations/social-neuron-staging";

const STAGING_IDENTITY = Object.freeze({
  service: "social-neuron" as const,
  environment: "staging" as const,
  deploymentId: "sn-staging-deploy-a",
  commitSha: "abcdef123456",
  origin: "https://staging-canary.example.test",
  projectAlias: "webmcp-canary",
  accountAlias: "canary-social-account",
  capability: "publish-canary-v1" as const,
  canaryEnabled: true,
  databaseIsolation: "isolated" as const,
  providerMode: "canary_sink" as const,
  liveProviderCredentialsPresent: false,
  liveProviderEgressEnabled: false,
  workerMode: "production_lifecycle" as const,
  attestationDigest: "sha256:staging-attestation",
});

function observation(
  preparation: CanaryPreparation,
  overrides: Partial<PublishObservation> = {},
): PublishObservation {
  return {
    runId: preparation.runId,
    trial: preparation.trial,
    sequence: 1,
    post: {
      status: "approved",
      version: "v1",
      externalIdPresent: false,
      publishedAtPresent: false,
    },
    job: { status: "ready", attemptCount: 0 },
    sink: { status: "draft", deliveryCount: 0, receiptPresent: false },
    evidence: {
      source: "social-neuron-staging",
      attestationDigest: preparation.attestationDigest,
      observedAt: "2026-08-30T10:00:00.000Z",
      digest: `sha256:${preparation.runId}:before`,
    },
    ...overrides,
  };
}

class FakeStagingPort implements SocialNeuronStagingPort {
  readonly calls: string[] = [];
  readonly requestIds: string[] = [];
  readonly cleanedRuns: string[] = [];
  attestation: CanaryAttestation = STAGING_IDENTITY;
  omitAfterEvidenceFor: CanaryTrial | null = null;
  staleAfterEvidenceFor: CanaryTrial | null = null;
  mismatchedAttestationFor: CanaryTrial | null = null;
  leaseExpiresAt = "2026-08-30T10:05:00.000Z";
  preparationAttestationDigest = "sha256:staging-attestation";
  failCleanupFor: CanaryTrial | null = null;
  abortDuring: CanaryTrial | null = null;
  spuriousAbortDuring: CanaryTrial | null = null;
  readonly executionStarted: Promise<void>;
  #resolveExecutionStarted!: () => void;

  constructor() {
    this.executionStarted = new Promise<void>((resolve) => {
      this.#resolveExecutionStarted = resolve;
    });
  }

  async attest(): Promise<CanaryAttestation> {
    this.calls.push("attest");
    return this.attestation;
  }

  async prepare(
    trial: CanaryTrial,
    _requestId: string,
  ): Promise<CanaryPreparation> {
    this.calls.push(`prepare:${trial}`);
    return {
      runId: `run-${trial}`,
      trial,
      fixtureAlias: "publish-post-fixture",
      leaseExpiresAt: this.leaseExpiresAt,
      attestationDigest: this.preparationAttestationDigest,
    };
  }

  async read(preparation: CanaryPreparation): Promise<PublishObservation> {
    const previousReads = this.calls.filter(
      (call) => call === `read:${preparation.trial}`,
    ).length;
    this.calls.push(`read:${preparation.trial}`);

    if (previousReads === 0) {
      return observation(preparation);
    }

    const falseSuccess = preparation.trial === "false_success";
    const baseAfter = observation(preparation, {
      sequence: 2,
      post: {
        status: "posted",
        version: "v2",
        externalIdPresent: true,
        publishedAtPresent: true,
      },
      job: { status: "completed", attemptCount: 1 },
      sink: falseSuccess
        ? { status: "draft", deliveryCount: 0, receiptPresent: false }
        : { status: "published", deliveryCount: 1, receiptPresent: true },
      evidence: {
        source: "social-neuron-staging",
        attestationDigest: preparation.attestationDigest,
        observedAt: "2026-08-30T10:00:01.000Z",
        digest: `sha256:${preparation.runId}:after`,
      },
    });

    if (this.omitAfterEvidenceFor === preparation.trial) {
      return {
        ...baseAfter,
        evidence: { ...baseAfter.evidence, digest: "" },
      };
    }
    if (this.staleAfterEvidenceFor === preparation.trial) {
      return {
        ...baseAfter,
        post: { ...baseAfter.post, version: "v1" },
        evidence: {
          ...baseAfter.evidence,
          digest: `sha256:${preparation.runId}:before`,
        },
      };
    }
    if (this.mismatchedAttestationFor === preparation.trial) {
      return {
        ...baseAfter,
        evidence: {
          ...baseAfter.evidence,
          attestationDigest: "sha256:different-deployment",
        },
      };
    }
    return baseAfter;
  }

  async execute(
    preparation: CanaryPreparation,
    requestId: string,
    options?: { signal?: AbortSignal },
  ): Promise<PublishClaim> {
    this.calls.push(`execute:${preparation.trial}`);
    this.requestIds.push(requestId);
    if (this.abortDuring === preparation.trial) {
      this.#resolveExecutionStarted();
      return await new Promise<PublishClaim>((_resolve, reject) => {
        const rejectFromSignal = () =>
          reject(
            options?.signal?.reason ??
              new DOMException("Canary cancelled", "AbortError"),
          );
        if (options?.signal?.aborted) rejectFromSignal();
        else options?.signal?.addEventListener("abort", rejectFromSignal, {
          once: true,
        });
      });
    }
    if (this.spuriousAbortDuring === preparation.trial) {
      throw new DOMException("Dependency timed out", "AbortError");
    }
    return {
      runId: preparation.runId,
      trial: preparation.trial,
      requestId,
      status: "published",
      externalIdPresent: true,
    };
  }

  async cleanup(preparation: CanaryPreparation): Promise<void> {
    this.calls.push(`cleanup:${preparation.trial}`);
    this.cleanedRuns.push(preparation.runId);
    if (this.failCleanupFor === preparation.trial) {
      throw new Error("cleanup failed");
    }
  }
}

function createCanary(port: SocialNeuronStagingPort) {
  let id = 0;
  return createSocialNeuronPublishCanary({
    port,
    expectedIdentity: STAGING_IDENTITY,
    createId: () => `suite-${++id}`,
    now: () => Date.parse("2026-08-30T10:00:00.000Z"),
  });
}

describe("Social Neuron staging publish canary", () => {
  it("rejects a false publish claim and accepts a matching truthful publish", async () => {
    const port = new FakeStagingPort();
    const report = await createCanary(port).run();

    expect(report).toMatchObject({
      status: "passed",
      verdict: "false_success_caught",
      environment: "staging",
      deploymentId: "sn-staging-deploy-a",
      trials: {
        falseSuccess: {
          claim: "published",
          authoritativeState: "draft",
          judgment: "rejected",
        },
        truthful: {
          claim: "published",
          authoritativeState: "published",
          judgment: "accepted",
        },
      },
      sensitivity: { status: "passed", mutant: "trust_handler_claim" },
      cleanup: "completed",
    });
    expect(port.calls).toEqual([
      "attest",
      "prepare:false_success",
      "read:false_success",
      "execute:false_success",
      "read:false_success",
      "cleanup:false_success",
      "prepare:truthful_success",
      "read:truthful_success",
      "execute:truthful_success",
      "read:truthful_success",
      "cleanup:truthful_success",
    ]);
    expect(port.requestIds).toEqual([
      "suite-1-false_success",
      "suite-1-truthful_success",
    ]);
  });

  it("fails closed before preparing a fixture when the server is not staging", async () => {
    const port = new FakeStagingPort();
    port.attestation = { ...STAGING_IDENTITY, environment: "production" };

    const report = await createCanary(port).run();

    expect(report).toMatchObject({
      status: "blocked",
      reason: "WRONG_ENVIRONMENT",
      mutationAttempted: false,
      cleanup: "not_needed",
    });
    expect(port.calls).toEqual(["attest"]);
  });

  it("blocks a staging-labelled server that still has live-provider egress", async () => {
    const port = new FakeStagingPort();
    port.attestation = {
      ...STAGING_IDENTITY,
      liveProviderEgressEnabled: true,
    };

    const report = await createCanary(port).run();

    expect(report).toMatchObject({
      status: "blocked",
      reason: "IDENTITY_MISMATCH",
      mutationAttempted: false,
    });
    expect(port.calls).toEqual(["attest"]);
  });

  it("returns inconclusive and cleans up when authoritative evidence is incomplete", async () => {
    const port = new FakeStagingPort();
    port.omitAfterEvidenceFor = "false_success";

    const report = await createCanary(port).run();

    expect(report).toMatchObject({
      status: "inconclusive",
      reason: "EVIDENCE_INCOMPLETE",
      cleanup: "completed",
    });
    expect(port.cleanedRuns).toEqual(["run-false_success"]);
    expect(port.calls).not.toContain("prepare:truthful_success");
  });

  it("rejects stale evidence and evidence bound to a different attestation", async () => {
    const stalePort = new FakeStagingPort();
    stalePort.staleAfterEvidenceFor = "false_success";
    await expect(createCanary(stalePort).run()).resolves.toMatchObject({
      status: "inconclusive",
      reason: "EVIDENCE_INCOMPLETE",
    });

    const mismatchedPort = new FakeStagingPort();
    mismatchedPort.mismatchedAttestationFor = "false_success";
    await expect(createCanary(mismatchedPort).run()).resolves.toMatchObject({
      status: "inconclusive",
      reason: "EVIDENCE_INCOMPLETE",
    });
  });

  it("does not execute a fixture whose lease has expired", async () => {
    const port = new FakeStagingPort();
    port.leaseExpiresAt = "2026-08-30T09:59:59.000Z";

    const report = await createCanary(port).run();

    expect(report).toMatchObject({
      status: "inconclusive",
      reason: "EVIDENCE_INCOMPLETE",
      cleanup: "completed",
    });
    expect(port.calls).not.toContain("execute:false_success");
  });

  it("does not read or execute a fixture bound to a different deployment attestation", async () => {
    const port = new FakeStagingPort();
    port.preparationAttestationDigest = "sha256:different-deployment";

    const report = await createCanary(port).run();

    expect(report).toMatchObject({
      status: "inconclusive",
      reason: "EVIDENCE_INCOMPLETE",
      cleanup: "completed",
    });
    expect(port.calls).not.toContain("read:false_success");
    expect(port.calls).not.toContain("execute:false_success");
  });

  it("never reports a pass when cleanup fails", async () => {
    const port = new FakeStagingPort();
    port.failCleanupFor = "false_success";

    const report = await createCanary(port).run();

    expect(report).toMatchObject({
      status: "blocked",
      reason: "CLEANUP_FAILED",
      cleanup: "failed",
    });
    expect(report.status).not.toBe("passed");
  });

  it("still cleans the leased fixture when execution is cancelled", async () => {
    const port = new FakeStagingPort();
    port.abortDuring = "false_success";
    const controller = new AbortController();

    const pending = createCanary(port).run({ signal: controller.signal });
    await port.executionStarted;
    controller.abort(new DOMException("Caller cancelled", "AbortError"));

    await expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(port.cleanedRuns).toEqual(["run-false_success"]);
  });

  it("treats a dependency AbortError as a remote failure unless the caller cancelled", async () => {
    const port = new FakeStagingPort();
    port.spuriousAbortDuring = "false_success";

    const report = await createCanary(port).run();

    expect(report).toMatchObject({
      status: "blocked",
      reason: "REMOTE_FAILURE",
      cleanup: "completed",
    });
    expect(port.cleanedRuns).toEqual(["run-false_success"]);
  });
});
