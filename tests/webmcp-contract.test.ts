import { describe, expect, it, vi } from "vitest";

import { detectBrowserModelContext } from "../src/adapters/webmcp/browser-model-context";
import {
  DuplicateWorkbenchRegistrationError,
  MAX_PARAMETER_DESCRIPTION_CHARACTERS,
  MAX_TOOL_DESCRIPTION_CHARACTERS,
  MAX_TOOL_RESULT_CHARACTERS,
  WebMcpRegistrationError,
  WEBMCP_TOOL_NAMES,
  registerWorkbenchTools,
} from "../src/adapters/webmcp/register-workbench-tools";
import { InMemoryModelContext } from "../src/testing/in-memory-model-context";
import type {
  AgentCommand,
  Outcome,
  WorkbenchAgent,
  WorkbenchPhase,
} from "../src/workbench/interface";
import { createOAuthWorkbenchSession } from "../src/workbench";

class RecordingAgent implements WorkbenchAgent {
  phase: WorkbenchPhase = "case_loaded";
  readonly calls: Array<{
    command: AgentCommand;
    signal: AbortSignal | undefined;
  }> = [];

  async execute(
    command: AgentCommand,
    options?: { signal?: AbortSignal },
  ): Promise<Outcome> {
    this.calls.push({ command, signal: options?.signal });

    return {
      ok: true,
      command: command.kind,
      phase: this.phase,
      summary: `Completed ${command.kind}.`,
      data: { phaseMarker: this.phase },
      allowedNextActions: ["read_case"],
    };
  }
}

describe("WebMCP workbench contract", () => {
  it("registers the stable six-tool surface exactly once", async () => {
    const modelContext = new InMemoryModelContext();
    const agent = new RecordingAgent();

    const registration = registerWorkbenchTools(agent, modelContext);
    await registration.ready;
    const duplicate = registerWorkbenchTools(agent, modelContext);
    await duplicate.ready;

    expect(modelContext.listTools().map((tool) => tool.name)).toEqual(
      WEBMCP_TOOL_NAMES,
    );
    expect(modelContext.registrationAttempts).toHaveLength(6);
    expect(duplicate).toBe(registration);
    expect(registration.getStatus()).toEqual({
      state: "ready",
      registeredToolCount: 6,
      totalToolCount: 6,
    });
  });

  it("publishes strict bounded schemas and truthful annotations", async () => {
    const modelContext = new InMemoryModelContext();
    const registration = registerWorkbenchTools(
      new RecordingAgent(),
      modelContext,
    );
    await registration.ready;

    const tools = modelContext.listTools();
    const readOnlyNames = new Set([
      "read_case",
      "explain_finding",
      "prepare_report",
    ]);
    const untrustedOutputNames = new Set([
      "read_case",
      "explain_finding",
      "prepare_report",
    ]);

    for (const tool of tools) {
      expect(tool.name.length).toBeLessThanOrEqual(30);
      expect(tool.description.length).toBeLessThanOrEqual(
        MAX_TOOL_DESCRIPTION_CHARACTERS,
      );
      expect(tool.inputSchema).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
      expect(tool.annotations).toEqual({
        readOnlyHint: readOnlyNames.has(tool.name),
        untrustedContentHint: untrustedOutputNames.has(tool.name),
      });
    }

    const findingSchema = modelContext.getTool("explain_finding")!
      .inputSchema as {
      properties: { findingId: { description: string } };
      required: string[];
    };
    expect(findingSchema.required).toEqual(["findingId"]);
    expect(findingSchema.properties.findingId.description.length).toBeLessThanOrEqual(
      MAX_PARAMETER_DESCRIPTION_CHARACTERS,
    );
    expect(MAX_TOOL_RESULT_CHARACTERS).toBe(1_500);
    expect(new Set(tools.map((tool) => tool.description)).size).toBe(6);
  });

  it("marks residual human-edited finding evidence as untrusted", async () => {
    const session = createOAuthWorkbenchSession();
    const modelContext = new InMemoryModelContext();
    await registerWorkbenchTools(session.agent, modelContext).ready;

    await modelContext.invoke("run_diagnostics");
    await modelContext.invoke("stage_sandbox_fix", {
      findingId: "finding-redirect-uri-01",
    });
    const staged = session.observe.getSnapshot().patch!;
    await session.human.execute({
      kind: "edit_patch",
      expected: staged.ref,
      after: "https://demo.example.com/oauth/callback/",
    });
    const edited = session.observe.getSnapshot().patch!;
    await session.human.execute({
      kind: "confirm_patch",
      expected: edited.ref,
    });

    const replay = JSON.parse(await modelContext.invoke("replay_flow")) as {
      data: { status: string };
    };
    const explanation = JSON.parse(
      await modelContext.invoke("explain_finding", {
        findingId: "finding-redirect-uri-01",
      }),
    ) as { data: { evidence: Array<{ observed: string }> } };

    expect(replay.data.status).toBe("failed");
    expect(explanation.data.evidence[0]?.observed).toBe(
      "https://demo.example.com/oauth/callback/",
    );
    expect(modelContext.getTool("explain_finding")?.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
  });

  it("maps every invocation to the agent using the caller's AbortSignal", async () => {
    const modelContext = new InMemoryModelContext();
    const agent = new RecordingAgent();
    await registerWorkbenchTools(agent, modelContext).ready;
    const execution = new AbortController();

    const inputs: Record<string, unknown> = {
      read_case: {},
      run_diagnostics: {},
      explain_finding: { findingId: "finding-redirect-uri-01" },
      stage_sandbox_fix: { findingId: "finding-redirect-uri-01" },
      replay_flow: {},
      prepare_report: {},
    };

    for (const name of WEBMCP_TOOL_NAMES) {
      const serialized = await modelContext.invoke(name, inputs[name], {
        signal: execution.signal,
      });
      expect(serialized.length).toBeLessThanOrEqual(
        MAX_TOOL_RESULT_CHARACTERS,
      );
    }

    expect(agent.calls.map(({ command }) => command)).toEqual([
      { kind: "read_case" },
      { kind: "run_diagnostics" },
      { kind: "explain_finding", findingId: "finding-redirect-uri-01" },
      { kind: "stage_sandbox_fix", findingId: "finding-redirect-uri-01" },
      { kind: "replay_flow" },
      { kind: "prepare_report" },
    ]);
    expect(agent.calls.every(({ signal }) => signal === execution.signal)).toBe(
      true,
    );
  });

  it("remains compatible when a browser omits execution options", async () => {
    const agent = new RecordingAgent();
    const modelContext = new InMemoryModelContext();
    await registerWorkbenchTools(agent, modelContext).ready;

    const result = await modelContext.getTool("read_case")!.execute({});

    expect(result).toMatchObject({ ok: true, command: "read_case" });
    expect(agent.calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reads current agent state at execution time", async () => {
    const modelContext = new InMemoryModelContext();
    const agent = new RecordingAgent();
    await registerWorkbenchTools(agent, modelContext).ready;

    const before = JSON.parse(await modelContext.invoke("read_case")) as {
      phase: string;
    };
    agent.phase = "diagnosed";
    const after = JSON.parse(await modelContext.invoke("read_case")) as {
      phase: string;
    };

    expect(before.phase).toBe("case_loaded");
    expect(after.phase).toBe("diagnosed");
  });

  it("rejects unknown fields and missing finding IDs inside handlers", async () => {
    const modelContext = new InMemoryModelContext();
    const agent = new RecordingAgent();
    agent.phase = "diagnosed";
    await registerWorkbenchTools(agent, modelContext).ready;

    const extraField = JSON.parse(
      await modelContext.invoke("run_diagnostics", { ignored: true }),
    ) as {
      ok: boolean;
      command: string;
      phase: string;
      error: { code: string };
    };
    const missingRequired = JSON.parse(
      await modelContext.invoke("explain_finding", {}),
    ) as {
      ok: boolean;
      command: string;
      error: { code: string };
    };
    const findingWithExtraField = JSON.parse(
      await modelContext.invoke("stage_sandbox_fix", {
        findingId: "finding-redirect-uri-01",
        after: "https://invalid.example/callback",
      }),
    ) as { ok: boolean; error: { code: string } };

    expect(extraField).toMatchObject({
      ok: false,
      command: "run_diagnostics",
      phase: "diagnosed",
      error: { code: "INVALID_INPUT" },
    });
    expect(missingRequired).toMatchObject({
      ok: false,
      command: "explain_finding",
      error: { code: "INVALID_INPUT" },
    });
    expect(findingWithExtraField).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    expect(
      agent.calls.some(({ command }) => command.kind === "run_diagnostics"),
    ).toBe(false);
    expect(
      agent.calls.some(({ command }) => command.kind === "explain_finding"),
    ).toBe(false);
    expect(
      agent.calls.some(({ command }) => command.kind === "stage_sandbox_fix"),
    ).toBe(false);
  });

  it("fails closed when a tool result exceeds the tested output budget", async () => {
    const modelContext = new InMemoryModelContext();
    const oversizedAgent: WorkbenchAgent = {
      async execute(command): Promise<Outcome> {
        return {
          ok: true,
          command: command.kind,
          phase: "case_loaded",
          summary: "x".repeat(MAX_TOOL_RESULT_CHARACTERS * 2),
          allowedNextActions: ["read_case"],
        };
      },
    };
    await registerWorkbenchTools(oversizedAgent, modelContext).ready;

    const serialized = await modelContext.invoke("read_case");
    const result = JSON.parse(serialized) as {
      ok: boolean;
      error: { code: string };
    };

    expect(serialized.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARACTERS);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "OUTPUT_BUDGET_EXCEEDED" },
    });
  });

  it("cleans up every tool on disposal and makes disposal idempotent", async () => {
    const modelContext = new InMemoryModelContext();
    const registration = registerWorkbenchTools(
      new RecordingAgent(),
      modelContext,
    );
    await registration.ready;

    registration.dispose();
    registration.dispose();

    expect(modelContext.listTools()).toEqual([]);
    expect(registration.getStatus()).toEqual({
      state: "disposed",
      registeredToolCount: 0,
      totalToolCount: 6,
    });
    await expect(modelContext.invoke("read_case")).rejects.toThrow(
      "No registered tool",
    );
  });

  it("removes partial registrations and surfaces registration failures", async () => {
    const modelContext = new InMemoryModelContext();
    modelContext.failRegistration("stage_sandbox_fix");

    const registration = registerWorkbenchTools(
      new RecordingAgent(),
      modelContext,
    );

    await expect(registration.ready).rejects.toBeInstanceOf(
      WebMcpRegistrationError,
    );
    expect(modelContext.listTools()).toEqual([]);
    expect(registration.getStatus()).toEqual({
      state: "failed",
      registeredToolCount: 0,
      totalToolCount: 6,
      errorCode: "REGISTRATION_FAILED",
      errorName: "Error",
    });
  });

  it("retries cleanly after a transient registration failure", async () => {
    const modelContext = new InMemoryModelContext();
    const agent = new RecordingAgent();
    modelContext.failRegistration("run_diagnostics");
    const failed = registerWorkbenchTools(agent, modelContext);
    await expect(failed.ready).rejects.toBeInstanceOf(WebMcpRegistrationError);

    const retried = registerWorkbenchTools(agent, modelContext);
    await retried.ready;

    expect(retried).not.toBe(failed);
    expect(retried.getStatus().state).toBe("ready");
    expect(modelContext.listTools().map((tool) => tool.name)).toEqual(
      WEBMCP_TOOL_NAMES,
    );
  });

  it("does not let a status subscriber abort tool registration", async () => {
    const modelContext = new InMemoryModelContext();
    const registration = registerWorkbenchTools(
      new RecordingAgent(),
      modelContext,
    );
    registration.subscribe((status) => {
      if (status.registeredToolCount > 0) {
        throw new Error("Broken status consumer.");
      }
    });

    await registration.ready;

    expect(registration.getStatus().state).toBe("ready");
    expect(modelContext.listTools().map((tool) => tool.name)).toEqual(
      WEBMCP_TOOL_NAMES,
    );
  });

  it("rejects binding one active model context to a different session agent", async () => {
    const modelContext = new InMemoryModelContext();
    await registerWorkbenchTools(new RecordingAgent(), modelContext).ready;

    expect(() =>
      registerWorkbenchTools(new RecordingAgent(), modelContext),
    ).toThrow(DuplicateWorkbenchRegistrationError);
    expect(modelContext.registrationAttempts).toHaveLength(6);
  });

  it("forwards execution cancellation to a long-running replay", async () => {
    const modelContext = new InMemoryModelContext();
    let observedSignal: AbortSignal | undefined;
    const replayAgent: WorkbenchAgent = {
      async execute(command, options): Promise<Outcome> {
        observedSignal = options?.signal;
        return await new Promise<Outcome>((resolve) => {
          options?.signal?.addEventListener(
            "abort",
            () =>
              resolve({
                ok: false,
                command: command.kind,
                phase: "approved",
                error: {
                  code: "OPERATION_CANCELLED",
                  message: "Replay was cancelled.",
                  nextAction: "Read the case before retrying replay.",
                },
                allowedNextActions: ["read_case"],
              }),
            { once: true },
          );
        });
      },
    };
    await registerWorkbenchTools(replayAgent, modelContext).ready;
    const execution = new AbortController();

    const replay = modelContext.invoke("replay_flow", {}, {
      signal: execution.signal,
    });
    execution.abort(new DOMException("Cancelled by caller.", "AbortError"));

    await expect(replay).rejects.toMatchObject({ name: "AbortError" });
    expect(observedSignal).toBe(execution.signal);
    expect(observedSignal?.aborted).toBe(true);
  });

  it("rejects when a handler aborts synchronously before the test listener attaches", async () => {
    const modelContext = new InMemoryModelContext();
    const execution = new AbortController();
    const cancellingAgent: WorkbenchAgent = {
      async execute(command): Promise<Outcome> {
        execution.abort(new DOMException("Cancelled immediately.", "AbortError"));
        return {
          ok: true,
          command: command.kind,
          phase: "case_loaded",
          summary: "This late result must be discarded.",
          allowedNextActions: ["read_case"],
        };
      },
    };
    await registerWorkbenchTools(cancellingAgent, modelContext).ready;

    await expect(
      modelContext.invoke("read_case", {}, { signal: execution.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("detects and registers through the top-level imperative browser API", async () => {
    const registered: Array<{
      name: string;
      options: Record<string, unknown>;
    }> = [];
    const browserModelContext = {
      registerTool: vi.fn(
        async (
          tool: { name: string },
          options: Record<string, unknown>,
        ) => {
          registered.push({ name: tool.name, options });
        },
      ),
    };
    const topLevelView: { top: unknown; isSecureContext: boolean } = {
      top: null,
      isSecureContext: true,
    };
    topLevelView.top = topLevelView;
    const documentLike = {
      defaultView: topLevelView,
      modelContext: browserModelContext,
    };

    const availability = detectBrowserModelContext(documentLike);
    const repeatedDetection = detectBrowserModelContext(documentLike);
    expect(availability.state).toBe("available");
    expect(repeatedDetection.state).toBe("available");
    if (
      availability.state !== "available" ||
      repeatedDetection.state !== "available"
    ) {
      throw new Error("Expected WebMCP to be available.");
    }
    expect(repeatedDetection.registrar).toBe(availability.registrar);

    await registerWorkbenchTools(
      new RecordingAgent(),
      availability.registrar,
    ).ready;

    expect(registered.map(({ name }) => name)).toEqual(WEBMCP_TOOL_NAMES);
    expect(
      registered.every(
        ({ options }) =>
          Object.keys(options).length === 1 && options.signal instanceof AbortSignal,
      ),
    ).toBe(true);
  });

  it("returns structured handler data and serializes it exactly once on the wire", async () => {
    const modelContext = new InMemoryModelContext();
    await registerWorkbenchTools(new RecordingAgent(), modelContext).ready;
    const tool = modelContext.getTool("read_case")!;
    const execution = new AbortController();

    const directResult = await tool.execute(
      {},
      { signal: execution.signal },
    );
    const wireResult = await modelContext.invoke("read_case");

    expect(directResult).toMatchObject({
      ok: true,
      command: "read_case",
      phase: "case_loaded",
    });
    expect(wireResult.startsWith("{")).toBe(true);
    expect(JSON.parse(wireResult)).toMatchObject(directResult as object);
  });

  it("reports unsupported, nested, and insecure documents truthfully", () => {
    expect(detectBrowserModelContext(undefined)).toMatchObject({
      state: "unavailable",
      reason: "NO_ACTIVE_DOCUMENT",
    });
    expect(
      detectBrowserModelContext({
        defaultView: { top: {}, isSecureContext: true },
        modelContext: { registerTool: vi.fn() },
      }),
    ).toMatchObject({ state: "unavailable", reason: "NOT_TOP_LEVEL" });

    const insecureView: { top: unknown; isSecureContext: boolean } = {
      top: null,
      isSecureContext: false,
    };
    insecureView.top = insecureView;
    expect(
      detectBrowserModelContext({
        defaultView: insecureView,
        modelContext: { registerTool: vi.fn() },
      }),
    ).toMatchObject({ state: "unavailable", reason: "INSECURE_CONTEXT" });

    const unsupportedView: { top: unknown; isSecureContext: boolean } = {
      top: null,
      isSecureContext: true,
    };
    unsupportedView.top = unsupportedView;
    expect(
      detectBrowserModelContext({
        defaultView: unsupportedView,
      }),
    ).toMatchObject({ state: "unavailable", reason: "API_UNAVAILABLE" });
  });

  it("drives the real visible session from failure to a bounded receipt", async () => {
    const session = createOAuthWorkbenchSession();
    const modelContext = new InMemoryModelContext();
    const registration = registerWorkbenchTools(session.agent, modelContext);
    await registration.ready;

    const read = JSON.parse(await modelContext.invoke("read_case")) as {
      ok: boolean;
      phase: string;
    };
    expect(read).toMatchObject({ ok: true, phase: "case_loaded" });

    const diagnosed = JSON.parse(
      await modelContext.invoke("run_diagnostics"),
    ) as { ok: boolean; phase: string };
    expect(diagnosed).toMatchObject({ ok: true, phase: "diagnosed" });
    expect(session.observe.getSnapshot().findings).toHaveLength(1);

    const findingId = session.observe.getSnapshot().findings[0]!.id;
    await modelContext.invoke("explain_finding", { findingId });
    const staged = JSON.parse(
      await modelContext.invoke("stage_sandbox_fix", { findingId }),
    ) as { ok: boolean; phase: string };
    expect(staged).toMatchObject({
      ok: true,
      phase: "awaiting_human_approval",
    });
    expect(session.observe.getSnapshot().patch?.approvalStatus).toBe("pending");

    const deniedReplay = JSON.parse(
      await modelContext.invoke("replay_flow"),
    ) as { ok: boolean; error: { code: string } };
    expect(deniedReplay).toMatchObject({
      ok: false,
      error: { code: "HUMAN_APPROVAL_REQUIRED" },
    });

    const patchRef = session.observe.getSnapshot().patch!.ref;
    await session.human.execute({ kind: "confirm_patch", expected: patchRef });
    const replay = JSON.parse(await modelContext.invoke("replay_flow")) as {
      ok: boolean;
      phase: string;
    };
    expect(replay).toMatchObject({ ok: true, phase: "receipt_ready" });
    expect(session.observe.getSnapshot()).toMatchObject({
      phase: "receipt_ready",
      replay: { status: "succeeded" },
    });

    const report = await modelContext.invoke("prepare_report");
    expect(report.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARACTERS);
    expect(JSON.parse(report)).toMatchObject({
      ok: true,
      command: "prepare_report",
      phase: "receipt_ready",
    });

    registration.dispose();
    session.close();
  });
});
