import { env, exports } from "cloudflare:workers";
import {
  evictDurableObject,
  listDurableObjectIds,
  runInDurableObject,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { RefundRunState } from "../src/index";
import type {
  IssueRefundInput,
  RefundTargetInvokeClaim,
  RefundTargetObservation,
  RefundTargetReset,
  RefundTargetRun,
} from "../src/index";

const ALLOWED_ORIGIN = "http://127.0.0.1:5173";

describe("refund staging target HTTP contract", () => {
  it("issues two short-lived opaque capabilities with zero-effect baselines", async () => {
    const before = Date.now();
    const { response, data } = await reset();

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(data.attestation).toMatchObject({
      service: "action-check-refund-staging",
      environment: "staging",
      deploymentId: "local-development",
      capability: "refund-retry-effect-v1",
      store: "durable",
    });
    expect(data.attestation.attestationDigest).toMatch(/^sha256-[A-Za-z0-9_-]{43}$/);

    const runs = [data.runs.broken, data.runs.protected];
    expect(runs[0]?.runId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(runs[1]?.runId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(runs[0]?.runId).not.toBe(runs[1]?.runId);
    for (const run of runs) {
      expect(run.requestId).toBe("refund-request-204");
      expect(run.trialDigest).toBe("v1:1:pay-204:4200:USD:refund-request-204");
      expect(run.attestationDigest).toBe(data.attestation.attestationDigest);
      const lease = Date.parse(run.leaseExpiresAt);
      expect(lease).toBeGreaterThanOrEqual(before + 14 * 60_000);
      expect(lease).toBeLessThanOrEqual(Date.now() + 16 * 60_000);
    }

    for (const lane of ["broken", "protected"] as const) {
      expect(data.baseline[lane]).toEqual(
        expect.objectContaining({
          runId: data.runs[lane].runId,
          lane,
          sequence: 0,
          effectCount: 0,
          effectIds: [],
          source: "external-refund-staging",
        }),
      );
      expect(data.baseline[lane].evidenceDigest).toMatch(/^sha256-[A-Za-z0-9_-]{43}$/);
    }
  });

  it("proves the known-bad lane creates two effects after an acknowledgement loss", async () => {
    const { data: resetData } = await reset();
    const run = resetData.runs.broken;
    const input = refundInput("broken");

    const first = await invoke(run, input);
    const second = await invoke(run, input);
    const observed = await observe(run);

    expect(first.response.status).toBe(200);
    expect(first.data).toEqual({
      runId: run.runId,
      requestId: input.requestId,
      claim: "ack_lost",
    });
    expect(Object.keys(first.data).sort()).toEqual(["claim", "requestId", "runId"]);
    expect(second.data.claim).toBe("created");
    expect(observed.data).toEqual(
      expect.objectContaining({
        runId: run.runId,
        lane: "broken",
        sequence: 2,
        effectCount: 2,
        source: "external-refund-staging",
      }),
    );
    expect(new Set(observed.data.effectIds).size).toBe(2);
    expect(observed.data.evidenceDigest).not.toBe(resetData.baseline.broken.evidenceDigest);
  });

  it("rejects a third invocation without creating a third effect", async () => {
    const { data: resetData } = await reset();
    const run = resetData.runs.broken;
    const input = refundInput("broken");
    await invoke(run, input);
    await invoke(run, input);

    const third = await postJson<{ error: { code: string } }>("/v1/invoke", { run, input });
    expect(third.response.status).toBe(409);
    expect(third.data.error.code).toBe("CALL_LIMIT_REACHED");
    expect((await observe(run)).data).toEqual(
      expect.objectContaining({ sequence: 2, effectCount: 2 }),
    );
  });

  it("proves the protected lane reuses the request ID while observation stays fresh", async () => {
    const { data: resetData } = await reset();
    const run = resetData.runs.protected;
    const input = refundInput("protected");

    const first = await invoke(run, input);
    const afterFirst = await observe(run);
    const second = await invoke(run, input);
    const afterRetry = await observe(run);

    expect(first.data.claim).toBe("ack_lost");
    expect(second.data.claim).toBe("reused");
    expect(afterFirst.data).toEqual(
      expect.objectContaining({ sequence: 1, effectCount: 1 }),
    );
    expect(afterRetry.data).toEqual(
      expect.objectContaining({ sequence: 2, effectCount: 1 }),
    );
    expect(afterRetry.data.effectIds).toEqual(afterFirst.data.effectIds);
    expect(afterRetry.data.evidenceDigest).not.toBe(afterFirst.data.evidenceDigest);
  });

  it("deduplicates concurrent protected retries inside one coordination atom", async () => {
    const { data: resetData } = await reset();
    const run = resetData.runs.protected;
    const input = refundInput("protected");

    const attempts = await Promise.all([invoke(run, input), invoke(run, input)]);
    expect(attempts.map(({ data }) => data.claim).sort()).toEqual(["ack_lost", "reused"]);
    expect((await observe(run)).data).toEqual(
      expect.objectContaining({ sequence: 2, effectCount: 1 }),
    );
  });

  it("persists effects in SQLite across Durable Object eviction", async () => {
    const { data: resetData } = await reset();
    const run = resetData.runs.broken;
    const input = refundInput("broken");
    await invoke(run, input);

    const stub = await stubForCapability(run.runId);
    await runInDurableObject(stub, async (instance, state) => {
      expect(instance).toBeInstanceOf(RefundRunState);
      const stored = state.storage.sql
        .exec<{ effect_id: string }>("SELECT effect_id FROM effects")
        .toArray();
      expect(stored).toHaveLength(1);
    });
    await evictDurableObject(stub);

    expect((await invoke(run, input)).data.claim).toBe("created");
    expect((await observe(run)).data).toEqual(
      expect.objectContaining({ sequence: 2, effectCount: 2 }),
    );
  });

  it("binds retries to the reset metadata and the first mutation's exact effect", async () => {
    const { data: resetData } = await reset();
    const run = resetData.runs.protected;
    const input = refundInput("protected");
    await invoke(run, input);

    const changedAmount = await postJson<{ error: { code: string } }>("/v1/invoke", {
      run,
      input: { ...input, amountMinor: 4_201 },
    });
    expect(changedAmount.response.status).toBe(409);
    expect(changedAmount.data.error.code).toBe("INPUT_MISMATCH");

    const tamperedRun = await postJson<{ error: { code: string } }>("/v1/observe", {
      run: { ...run, trialDigest: `${run.trialDigest}:tampered` },
    });
    expect(tamperedRun.response.status).toBe(409);
    expect(tamperedRun.data.error.code).toBe("RUN_MISMATCH");

    expect((await observe(run)).data.effectCount).toBe(1);
  });

  it("cleans both lane stores and invalidates their capabilities", async () => {
    const { data: resetData } = await reset();
    await invoke(resetData.runs.broken, refundInput("broken"));
    await invoke(resetData.runs.protected, refundInput("protected"));

    const cleanup = await postJson<never>("/v1/cleanup", { runs: resetData.runs });
    expect(cleanup.response.status).toBe(204);

    for (const run of [resetData.runs.broken, resetData.runs.protected]) {
      const missing = await postJson<{ error: { code: string } }>("/v1/observe", { run });
      expect(missing.response.status).toBe(404);
      expect(missing.data.error.code).toBe("RUN_NOT_FOUND");
    }
  });

  it("rejects an expired capability while still allowing cleanup", async () => {
    const { data: resetData } = await reset();
    const stub = await stubForCapability(resetData.runs.broken.runId);
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec("UPDATE session SET expires_at = 0 WHERE singleton = 1");
    });

    const expired = await postJson<{ error: { code: string } }>("/v1/observe", {
      run: resetData.runs.broken,
    });
    expect(expired.response.status).toBe(410);
    expect(expired.data.error.code).toBe("CAPABILITY_EXPIRED");

    expect((await postJson<never>("/v1/cleanup", { runs: resetData.runs })).response.status).toBe(
      204,
    );
  });

  it("enforces exact-origin CORS and a strict JSON contract", async () => {
    const preflight = await exports.default.fetch("http://target.test/v1/reset", {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(preflight.headers.get("vary")).toContain("Origin");

    const denied = await exports.default.fetch("http://target.test/v1/reset", {
      method: "OPTIONS",
      headers: {
        Origin: "https://untrusted.example",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();

    const noOrigin = await exports.default.fetch("http://target.test/v1/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(resetBody()),
    });
    expect(noOrigin.status).toBe(403);

    const unexpected = await postJson<{ error: { code: string } }>("/v1/reset", {
      ...resetBody(),
      extra: true,
    });
    expect(unexpected.response.status).toBe(400);
    expect(unexpected.data.error.code).toBe("INVALID_REQUEST");
  });

  it("rate-limits reset before allocating another Durable Object", async () => {
    const successfulRuns: RefundTargetReset[] = [];
    let limitedResponse: Response | null = null;
    let limitedCode: string | null = null;

    for (let epoch = 100; epoch < 140; epoch += 1) {
      const attempt = await postJson<RefundTargetReset | { error: { code: string } }>(
        "/v1/reset",
        resetBody(epoch),
      );
      if (attempt.response.status === 429) {
        limitedResponse = attempt.response;
        limitedCode = (attempt.data as { error: { code: string } }).error.code;
        break;
      }
      expect(attempt.response.status).toBe(200);
      successfulRuns.push(attempt.data as RefundTargetReset);
    }

    expect(limitedResponse?.status).toBe(429);
    expect(limitedCode).toBe("RESET_RATE_LIMITED");
    expect(limitedResponse?.headers.get("retry-after")).toBe("10");

    const beforeRejectedReset = await listDurableObjectIds(env.REFUND_RUNS);
    const rejectedAgain = await postJson<{ error: { code: string } }>(
      "/v1/reset",
      resetBody(141),
    );
    const afterRejectedReset = await listDurableObjectIds(env.REFUND_RUNS);
    expect(rejectedAgain.response.status).toBe(429);
    expect(afterRejectedReset).toHaveLength(beforeRejectedReset.length);

    for (const created of successfulRuns) {
      expect((await postJson<never>("/v1/cleanup", { runs: created.runs })).response.status).toBe(
        204,
      );
    }
  });
});

function resetBody(epoch = 1) {
  return {
    trialRef: {
      trialId: `trial-${epoch}`,
      epoch,
      digest: `v1:${epoch}:pay-204:4200:USD:refund-request-204`,
    },
    requestId: "refund-request-204",
  } as const;
}

async function reset() {
  return postJson<RefundTargetReset>("/v1/reset", resetBody());
}

function refundInput(lane: "broken" | "protected"): IssueRefundInput {
  return {
    lane,
    paymentId: "pay-204",
    amountMinor: 4_200,
    currency: "USD",
    requestId: "refund-request-204",
  };
}

async function invoke(run: RefundTargetRun, input: IssueRefundInput) {
  return postJson<RefundTargetInvokeClaim>("/v1/invoke", { run, input });
}

async function observe(run: RefundTargetRun) {
  return postJson<RefundTargetObservation>("/v1/observe", { run });
}

async function postJson<T>(path: string, body: unknown): Promise<{
  response: Response;
  data: T;
}> {
  const response = await exports.default.fetch(`http://target.test${path}`, {
    method: "POST",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = response.status === 204 ? (undefined as T) : await response.json<T>();
  return { response, data };
}

async function stubForCapability(capability: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(capability)),
  );
  const hash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return env.REFUND_RUNS.getByName(`refund-run:${hash}`);
}
