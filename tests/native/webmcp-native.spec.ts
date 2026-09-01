import { expect, test } from "@playwright/test";

type NativeTool = Readonly<{
  name: string;
  frameId: string;
  annotations?: Readonly<{
    readOnly?: boolean;
    untrustedContent?: boolean;
  }>;
}>;

type ToolOutcome = Readonly<{
  ok: boolean;
  phase?: string;
  error?: Readonly<{ code?: string }>;
  data?: Readonly<Record<string, unknown>>;
}>;

test("the installed Chrome runs the approved refund proof through native WebMCP", async (
  { page },
  testInfo,
) => {
  await page.goto("/");

  await page.locator("details.technical-details > summary").click();
  await expect(
    page
      .getByRole("region", { name: "Can one retry accidentally refund twice?" })
      .getByText("Native WebMCP ready", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Next actor: Agent" })).toHaveAttribute(
    "data-next-action",
    "stage",
  );

  const browserEvidence = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    hasModelContext: "modelContext" in document,
    registerToolType: typeof (
      document as Document & {
        modelContext?: { registerTool?: unknown };
      }
    ).modelContext?.registerTool,
  }));

  expect(browserEvidence).toMatchObject({
    hasModelContext: true,
    registerToolType: "function",
  });

  const cdp = await page.context().newCDPSession(page);
  const send = cdp.send.bind(cdp) as unknown as (
    method: string,
    params?: Readonly<Record<string, unknown>>,
  ) => Promise<Record<string, unknown>>;
  const on = cdp.on.bind(cdp) as unknown as (
    event: string,
    listener: (payload: unknown) => void,
  ) => void;

  const toolsAdded = new Promise<readonly NativeTool[]>((resolve) => {
    on("WebMCP.toolsAdded", (payload) => {
      resolve((payload as { tools: readonly NativeTool[] }).tools);
    });
  });
  await send("WebMCP.enable");
  const tools = await toolsAdded;

  expect(tools.map(({ name }) => name).sort()).toEqual([
    "issue_refund",
    "prove_refund_comparison",
    "stage_refund_comparison",
  ]);
  expect(
    tools.find(({ name }) => name === "prove_refund_comparison")?.annotations,
  ).toMatchObject({ readOnly: false, untrustedContent: false });
  expect(
    tools.find(({ name }) => name === "issue_refund")?.annotations,
  ).toMatchObject({ readOnly: false, untrustedContent: false });

  let lastToolResponse: unknown;
  on("WebMCP.toolResponded", (payload) => {
    lastToolResponse = payload;
  });
  const nativeInputMode = await page.evaluate(async () => {
    type NativeModelContext = Readonly<{
      getTools(): Promise<readonly Readonly<{ name: string }>[]>
      executeTool(
        tool: Readonly<{ name: string }>,
        input: unknown,
      ): Promise<unknown>;
    }>;
    const modelContext = (
      document as Document & { modelContext: NativeModelContext }
    ).modelContext;
    const nativeTools = await modelContext.getTools();
    const proofTool = nativeTools.find(
      (candidate) => candidate.name === "prove_refund_comparison",
    );
    if (!proofTool) throw new Error("Native proof tool not found");
    try {
      await modelContext.executeTool(proofTool, {});
      return "object" as const;
    } catch {
      return "json-text" as const;
    }
  });

  const invoke = async (
    toolName: string,
    input: Readonly<Record<string, unknown>> = {},
  ): Promise<ToolOutcome> => {
    try {
      const invocation = await page.evaluate(
        async ({ name, args, inputMode }) => {
        type NativeModelContext = Readonly<{
          getTools(): Promise<readonly Readonly<{ name: string }>[]>;
          executeTool(
            tool: Readonly<{ name: string }>,
            input: unknown,
          ): Promise<unknown>;
        }>;
        const modelContext = (
          document as Document & { modelContext: NativeModelContext }
        ).modelContext;
        const nativeTools = await modelContext.getTools();
        const tool = nativeTools.find((candidate) => candidate.name === name);
        if (!tool) throw new Error(`Native WebMCP tool not found: ${name}`);
        return await modelContext.executeTool(
          tool,
          inputMode === "object" ? args : JSON.stringify(args),
        );
        },
        { name: toolName, args: input, inputMode: nativeInputMode },
      );
      return (typeof invocation === "string"
        ? JSON.parse(invocation)
        : invocation) as ToolOutcome;
    } catch (error) {
      await page.waitForTimeout(0);
      throw new Error(
        `Native ${toolName} invocation failed: ${JSON.stringify(lastToolResponse)}; ${String(error)}`,
      );
    }
  };

  const staged = await invoke("stage_refund_comparison");
  expect(staged).toMatchObject({
    ok: true,
    phase: "awaiting_approval",
    data: {
      paymentId: "pay-204",
      amountMinor: 4200,
      currency: "USD",
      requestId: "refund-request-204",
    },
  });
  await expect(page.getByRole("region", { name: "Next actor: Human" })).toHaveAttribute(
    "data-next-action",
    "approve",
  );

  const exactInput = {
    paymentId: "pay-204",
    amountMinor: 4200,
    currency: "USD",
    requestId: "refund-request-204",
  } as const;
  expect(
    await invoke("issue_refund", { ...exactInput, lane: "broken" }),
  ).toMatchObject({
    ok: false,
    error: { code: "HUMAN_APPROVAL_REQUIRED" },
  });

  await page
    .getByRole("button", { name: "Approve exact staging refund" })
    .click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Next actor: Agent" })).toHaveAttribute(
    "data-next-action",
    "deliver",
  );

  expect(
    await invoke("issue_refund", { ...exactInput, lane: "broken" }),
  ).toMatchObject({
    ok: false,
    error: { code: "PROVIDER_ACK_LOST_AFTER_COMMIT" },
  });
  await expect(page.getByRole("region", { name: "Next actor: Agent" })).toHaveAttribute(
    "data-next-action",
    "retry",
  );
  expect(
    await invoke("issue_refund", { ...exactInput, lane: "broken" }),
  ).toMatchObject({
    ok: true,
    data: { claim: "new_refund_created" },
  });
  await expect(page.getByRole("region", { name: "Next actor: Agent" })).toHaveAttribute(
    "data-next-action",
    "deliver",
  );
  expect(
    await invoke("issue_refund", { ...exactInput, lane: "protected" }),
  ).toMatchObject({
    ok: false,
    error: { code: "PROVIDER_ACK_LOST_AFTER_COMMIT" },
  });
  await expect(page.getByRole("region", { name: "Next actor: Agent" })).toHaveAttribute(
    "data-next-action",
    "retry",
  );
  expect(
    await invoke("issue_refund", { ...exactInput, lane: "protected" }),
  ).toMatchObject({
    ok: true,
    data: { claim: "existing_refund_reused" },
  });
  await expect(page.getByRole("region", { name: "Next actor: Agent" })).toHaveAttribute(
    "data-next-action",
    "prove",
  );

  expect(await invoke("prove_refund_comparison")).toMatchObject({
    ok: true,
    phase: "proof_ready",
    data: {
      proof: {
        broken: { attempts: 2, providerRefunds: 2 },
        protected: { attempts: 2, providerRefunds: 1 },
        evidenceSource:
          "external staging ledger read separately from the WebMCP response",
      },
    },
  });
  await expect(page.getByRole("region", { name: "Workflow complete" })).toHaveAttribute(
    "data-next-action",
    "complete",
  );

  await expect(
    page.getByRole("region", {
      name: "Caught the unsafe duplicate. Protected stayed single.",
    }),
  ).toBeVisible();
  const comparison = page.getByLabel("Refund retry comparison");
  await expect(
    comparison.getByRole("region", { name: "Unsafe retry" }),
  ).toContainText("Refunds created2");
  await expect(
    comparison.getByRole("region", { name: "Protected retry" }),
  ).toContainText("Refunds created1");
  expect(["object", "json-text"]).toContain(nativeInputMode);
  testInfo.annotations.push({
    type: "native-input-mode",
    description: nativeInputMode ?? "not-observed",
  });
});
