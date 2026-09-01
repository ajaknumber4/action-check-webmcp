import { describe, expect, it, vi } from "vitest";
import {
  MAX_SOCIAL_NEURON_CANARY_RESULT_CHARACTERS,
  SOCIAL_NEURON_CANARY_TOOL_NAME,
  registerSocialNeuronCanaryTool,
} from "../src/adapters/webmcp/register-social-neuron-canary-tool";
import type {
  BrowserCanaryReport,
  BrowserSocialNeuronCanaryRunner,
} from "../src/integrations/social-neuron-staging/browser-client";
import { InMemoryModelContext } from "../src/testing/in-memory-model-context";

const blockedReport: BrowserCanaryReport = {
  status: "blocked",
  reason: "STAGING_NOT_CONFIGURED",
  mutationAttempted: false,
  cleanup: "not_needed",
};

describe("Social Neuron staging WebMCP tool", () => {
  it("is absent until the caller explicitly registers it", async () => {
    const modelContext = new InMemoryModelContext();
    const runner = { run: vi.fn(async () => blockedReport) };

    expect(modelContext.getTool(SOCIAL_NEURON_CANARY_TOOL_NAME)).toBeUndefined();

    const registration = registerSocialNeuronCanaryTool(runner, modelContext);
    await registration.ready;

    expect(modelContext.getTool(SOCIAL_NEURON_CANARY_TOOL_NAME)).toBeDefined();
  });

  it("publishes a fixed, strict, mutating tool contract", async () => {
    const modelContext = new InMemoryModelContext();
    const registration = registerSocialNeuronCanaryTool(
      { run: vi.fn(async () => blockedReport) },
      modelContext,
    );
    await registration.ready;

    const tool = modelContext.getTool(SOCIAL_NEURON_CANARY_TOOL_NAME);
    expect(tool).toMatchObject({
      name: "run_social_neuron_canary",
      title: "Run Social Neuron staging check",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        untrustedContentHint: false,
      },
    });
    expect(tool?.description).toContain("fixed isolated");
    expect(tool?.description).toContain("cannot choose accounts");
  });

  it("rejects unknown fields without invoking the staging runner", async () => {
    const modelContext = new InMemoryModelContext();
    const runner = { run: vi.fn(async () => blockedReport) };
    const registration = registerSocialNeuronCanaryTool(runner, modelContext);
    await registration.ready;

    const serialized = await modelContext.invoke(
      SOCIAL_NEURON_CANARY_TOOL_NAME,
      { target: "production", account: "caller-selected" },
    );

    expect(JSON.parse(serialized)).toEqual({
      status: "blocked",
      reason: "INVALID_REQUEST",
      mutationAttempted: false,
      cleanup: "not_needed",
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("forwards the caller AbortSignal and returns the bounded report", async () => {
    const modelContext = new InMemoryModelContext();
    let observedSignal: AbortSignal | undefined;
    const runner: BrowserSocialNeuronCanaryRunner = {
      async run(options) {
        observedSignal = options?.signal;
        return blockedReport;
      },
    };
    const registration = registerSocialNeuronCanaryTool(runner, modelContext);
    await registration.ready;
    const execution = new AbortController();

    const serialized = await modelContext.invoke(
      SOCIAL_NEURON_CANARY_TOOL_NAME,
      {},
      { signal: execution.signal },
    );

    expect(observedSignal).toBe(execution.signal);
    expect(serialized.length).toBeLessThanOrEqual(
      MAX_SOCIAL_NEURON_CANARY_RESULT_CHARACTERS,
    );
    expect(JSON.parse(serialized)).toEqual(blockedReport);
  });

  it("propagates cancellation to a running canary", async () => {
    const modelContext = new InMemoryModelContext();
    let observedSignal: AbortSignal | undefined;
    const runner: BrowserSocialNeuronCanaryRunner = {
      async run(options) {
        observedSignal = options?.signal;
        return await new Promise<BrowserCanaryReport>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        });
      },
    };
    const registration = registerSocialNeuronCanaryTool(runner, modelContext);
    await registration.ready;
    const execution = new AbortController();

    const invocation = modelContext.invoke(
      SOCIAL_NEURON_CANARY_TOOL_NAME,
      {},
      { signal: execution.signal },
    );
    execution.abort(new DOMException("Cancelled by caller.", "AbortError"));

    await expect(invocation).rejects.toMatchObject({ name: "AbortError" });
    expect(observedSignal).toBe(execution.signal);
    expect(observedSignal?.aborted).toBe(true);
  });

  it("withholds unexpectedly large runner output", async () => {
    const modelContext = new InMemoryModelContext();
    const oversized = {
      ...blockedReport,
      unexpectedEvidence: "x".repeat(
        MAX_SOCIAL_NEURON_CANARY_RESULT_CHARACTERS * 2,
      ),
    } as unknown as BrowserCanaryReport;
    const registration = registerSocialNeuronCanaryTool(
      { run: vi.fn(async () => oversized) },
      modelContext,
    );
    await registration.ready;

    const serialized = await modelContext.invoke(
      SOCIAL_NEURON_CANARY_TOOL_NAME,
    );

    expect(serialized.length).toBeLessThanOrEqual(
      MAX_SOCIAL_NEURON_CANARY_RESULT_CHARACTERS,
    );
    expect(JSON.parse(serialized)).toEqual({
      status: "blocked",
      reason: "STAGING_REQUEST_FAILED",
      mutationAttempted: false,
      cleanup: "not_needed",
    });
  });

  it("unregisters the optional tool when disposed", async () => {
    const modelContext = new InMemoryModelContext();
    const registration = registerSocialNeuronCanaryTool(
      { run: vi.fn(async () => blockedReport) },
      modelContext,
    );
    await registration.ready;

    registration.dispose();
    registration.dispose();

    expect(modelContext.getTool(SOCIAL_NEURON_CANARY_TOOL_NAME)).toBeUndefined();
    await expect(
      modelContext.invoke(SOCIAL_NEURON_CANARY_TOOL_NAME),
    ).rejects.toThrow("No registered tool");
  });
});
