import { describe, expect, it, vi } from "vitest";

import { HttpRefundEffectTarget } from "../src/integrations/external-effect-staging/browser-target";
import type {
  RefundTargetObservation,
  RefundTargetReset,
} from "../src/refund-comparison";

const trialRef = {
  trialId: "refund-comparison-1",
  epoch: 1,
  digest: "v1:1:pay-204:4200:USD:refund-request-204",
} as const;

const attestation = {
  service: "action-check-refund-staging",
  environment: "staging",
  deploymentId: "refund-stage-20260831",
  capability: "refund-retry-effect-v1",
  store: "durable",
  attestationDigest: "sha256:attestation",
} as const;

const leaseExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

function run(lane: "broken" | "protected") {
  return {
    runId: `${lane}-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
    lane,
    requestId: "refund-request-204",
    trialDigest: trialRef.digest,
    leaseExpiresAt,
    attestationDigest: attestation.attestationDigest,
  } as const;
}

function observation(
  lane: "broken" | "protected",
  sequence = 0,
  effectIds: string[] = [],
): RefundTargetObservation {
  return {
    runId: run(lane).runId,
    lane,
    sequence,
    effectCount: effectIds.length,
    effectIds,
    evidenceDigest: `sha256:${lane}:${sequence}`,
    observedAt: "2026-08-31T12:00:00.000Z",
    source: "external-refund-staging",
  };
}

function resetPayload(): RefundTargetReset {
  return {
    attestation,
    runs: { broken: run("broken"), protected: run("protected") },
    baseline: {
      broken: observation("broken"),
      protected: observation("protected"),
    },
  };
}

describe("HTTP refund staging target", () => {
  it("uses fixed reset, invoke, observe, and cleanup endpoints with bounded contracts", async () => {
    const reset = resetPayload();
    const requests: Array<{ url: string; init: RequestInit }> = [];
    let fetchReceiver: unknown = "not-called";
    const fetchMock: typeof fetch = vi.fn(async function (
      this: unknown,
      input,
      init = {},
    ) {
      fetchReceiver = this;
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/v1/reset")) return json(reset);
      if (url.endsWith("/v1/invoke")) {
        return json({
          runId: reset.runs.broken.runId,
          requestId: "refund-request-204",
          claim: "ack_lost",
        });
      }
      if (url.endsWith("/v1/observe")) {
        return json(observation("broken", 1, ["stage-broken-1"]));
      }
      if (url.endsWith("/v1/cleanup")) return new Response(null, { status: 204 });
      return new Response(null, { status: 404 });
    }) as typeof fetch;
    const target = new HttpRefundEffectTarget({
      baseUrl: "https://refund-stage.example/",
      fetch: fetchMock,
    });

    const prepared = await target.reset({
      trialRef,
      requestId: "refund-request-204",
    });
    const input = {
      lane: "broken" as const,
      paymentId: "pay-204",
      amountMinor: 4200,
      currency: "USD",
      requestId: "refund-request-204",
    };
    await target.invoke(prepared.runs.broken, input);
    await target.observe(prepared.runs.broken);
    await target.cleanup(prepared);

    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      "/v1/reset",
      "/v1/invoke",
      "/v1/observe",
      "/v1/cleanup",
    ]);
    expect(fetchReceiver).toBeUndefined();
    expect(requests.every(({ init }) => init.redirect === "error")).toBe(true);
    expect(JSON.parse(String(requests[1]!.init.body))).toEqual({
      run: prepared.runs.broken,
      input,
    });
    expect(JSON.parse(String(requests[2]!.init.body))).toEqual({
      run: prepared.runs.broken,
    });
    expect(JSON.parse(String(requests[3]!.init.body))).toEqual({
      runs: prepared.runs,
    });
  });

  it("rejects non-HTTPS non-loopback targets and malformed or oversized responses", async () => {
    expect(
      () => new HttpRefundEffectTarget({ baseUrl: "http://refund-stage.example" }),
    ).toThrow(/HTTPS/);

    const malformed = new HttpRefundEffectTarget({
      baseUrl: "http://127.0.0.1:8787",
      fetch: vi.fn(async () => json({ state: "looks-fine" })) as typeof fetch,
    });
    await expect(
      malformed.reset({ trialRef, requestId: "refund-request-204" }),
    ).rejects.toMatchObject({ code: "MALFORMED_TARGET_RESPONSE" });

    const oversized = new HttpRefundEffectTarget({
      baseUrl: "http://localhost:8787",
      fetch: vi.fn(async () =>
        new Response("{}", {
          headers: { "content-type": "application/json", "content-length": "50000" },
        })) as typeof fetch,
    });
    await expect(
      oversized.reset({ trialRef, requestId: "refund-request-204" }),
    ).rejects.toMatchObject({ code: "TARGET_RESPONSE_TOO_LARGE" });

    const chunk = new TextEncoder().encode("x".repeat(20_000));
    const chunked = new HttpRefundEffectTarget({
      baseUrl: "http://localhost:8787",
      fetch: vi.fn(async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(chunk);
              controller.enqueue(chunk);
              controller.close();
            },
          }),
          { headers: { "content-type": "application/json" } },
        )) as typeof fetch,
    });
    await expect(
      chunked.reset({ trialRef, requestId: "refund-request-204" }),
    ).rejects.toMatchObject({ code: "TARGET_RESPONSE_TOO_LARGE" });
  });

  it("forwards caller cancellation without including opaque run IDs in errors", async () => {
    const controller = new AbortController();
    let derivedSignal: AbortSignal | null | undefined;
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const fetchMock: typeof fetch = vi.fn((_input, init = {}) => {
      derivedSignal = init.signal;
      markFetchStarted();
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("cancelled", "AbortError")),
          { once: true },
        );
      });
    }) as typeof fetch;
    const target = new HttpRefundEffectTarget({
      baseUrl: "http://127.0.0.1:8787",
      fetch: fetchMock,
    });

    const pending = target.observe(run("broken"), { signal: controller.signal });
    await fetchStarted;
    expect(derivedSignal).not.toBe(controller.signal);
    expect(derivedSignal?.aborted).toBe(false);
    controller.abort();
    expect(derivedSignal?.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
