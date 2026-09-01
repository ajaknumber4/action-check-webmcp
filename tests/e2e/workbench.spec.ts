import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

type BrowserToolOutcome = Readonly<{
  ok: boolean;
  phase?: string;
  error?: Readonly<{ code?: string }>;
  data?: Readonly<Record<string, unknown>>;
}>;

async function invokeRegisteredTool(
  page: Page,
  name: string,
  input: Readonly<Record<string, unknown>> = {},
): Promise<BrowserToolOutcome> {
  return await page.evaluate(
    async ({ toolName, args }) => {
      type RegisteredTool = Readonly<{
        execute(
          input: unknown,
          options: Readonly<{ signal: AbortSignal }>,
        ): Promise<unknown>;
      }>;
      const tools = (
        window as unknown as Window & {
          __workbenchTools: Record<string, RegisteredTool>;
        }
      ).__workbenchTools;
      const tool = tools[toolName];
      if (!tool) throw new Error(`Registered WebMCP tool not found: ${toolName}`);
      return (await tool.execute(args, {
        signal: new AbortController().signal,
      })) as BrowserToolOutcome;
    },
    { toolName: name, args: input },
  );
}

async function expectWorkflowGuide(
  page: Page,
  accessibleName: "Next actor: Agent" | "Next actor: Human" | "Workflow complete",
  nextAction: "stage" | "approve" | "deliver" | "retry" | "prove" | "complete",
): Promise<void> {
  const guide = page.getByRole("region", { name: accessibleName });
  await expect(guide).toBeVisible();
  await expect(guide).toHaveAttribute("data-next-action", nextAction);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    type RegisteredTool = Readonly<{
      name: string;
      annotations: Readonly<{
        readOnlyHint: boolean;
        untrustedContentHint: boolean;
      }>;
      execute(
        input: unknown,
        options: Readonly<{ signal: AbortSignal }>,
      ): Promise<unknown>;
    }>;

    const tools: Record<string, RegisteredTool> = {};
    Object.defineProperty(window, "__workbenchTools", {
      value: tools,
      configurable: false,
    });
    Object.defineProperty(document, "modelContext", {
      value: {
        async registerTool(
          tool: RegisteredTool,
          options?: Readonly<{ signal?: AbortSignal }>,
        ) {
          tools[tool.name] = tool;
          options?.signal?.addEventListener(
            "abort",
            () => delete tools[tool.name],
            { once: true },
          );
        },
      },
      configurable: false,
    });
  });
});

test("keeps Agent tools in the first 375 by 667 viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");

  await expect(
    page.getByRole("region", { name: "Agent tools" }),
  ).toBeInViewport({ ratio: 1 });
});

test("keeps audited mobile labels readable and controls touch-sized", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");

  const nativeStatus = page.locator(".refund-proof-registration strong");
  await expect(nativeStatus).toBeVisible();
  expect(
    await nativeStatus.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        overflow: style.overflow,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
      };
    }),
  ).toEqual({ overflow: "visible", textOverflow: "clip", whiteSpace: "normal" });

  const readableSelectors = [
    ".runner-intro small",
    ".refund-proof-kicker",
    ".refund-proof-registration small",
    ".refund-proof-registration strong",
    ".refund-proof-tool-strip-label small",
    ".refund-proof-tool-strip code",
    ".refund-proof-guide-next small",
    ".refund-proof-guide-next strong",
    ".refund-proof-guide-message p",
    ".refund-proof-guide-message small",
    ".refund-proof-prompt > span",
    ".refund-proof-prompt-body > p",
    ".refund-proof-prompt-body summary",
    ".refund-proof-path strong",
    ".refund-proof-path small",
    ".refund-proof-panel-label",
    ".refund-proof-trial-data dt",
    ".refund-proof-trial-data dd",
    ".selected-test-heading > div > span",
    ".passing-rule small",
    ".effect-contract > header small",
    ".effect-contract header code",
    ".contract-summary dt",
    ".contract-summary dd",
    ".contract-steps summary",
    ".fault-panel dt",
    ".fault-panel dd",
    ".technical-details summary",
  ];
  for (const selector of readableSelectors) {
    const size = await page.locator(selector).first().evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
    expect(size, `${selector} should render at 12px or larger`).toBeGreaterThanOrEqual(12);
  }

  for (const stage of await page.locator(".refund-proof-path small").all()) {
    expect(
      await stage.evaluate((element) => {
        const style = getComputedStyle(element);
        return style.whiteSpace === "normal" && element.scrollWidth <= element.clientWidth;
      }),
    ).toBe(true);
  }

  const controls = [
    page.getByRole("button", { name: "Run 4 UI examples" }),
    page.getByRole("button", { name: "Prove this test catches the bug" }),
    page.getByRole("button", { name: "Copy agent instruction" }),
    page.getByText("Show all 7 technical checks", { exact: true }),
    page.locator("summary").filter({ hasText: "Technical details" }),
  ];
  for (const control of controls) {
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }

  const mobileAccessibility = await new AxeBuilder({ page }).analyze();
  expect(mobileAccessibility.violations).toEqual([]);
});

test("shows four synthetic effect contracts with no production effects", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Test what WebMCP actions actually change.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "External synthetic staging demo · no payment account connected · no real money moves",
      { exact: true },
    ),
  ).toBeVisible();

  const agentTools = page.getByRole("region", { name: "Agent tools" });
  await expect(agentTools.getByRole("listitem")).toHaveCount(3);
  await expect(agentTools.getByText("stage_refund_comparison", { exact: true })).toBeVisible();
  await expect(agentTools.getByText("issue_refund", { exact: true })).toBeVisible();
  await expect(agentTools.getByText("prove_refund_comparison", { exact: true })).toBeVisible();
  await expect(agentTools.getByText("3 registered tools", { exact: true })).toBeVisible();

  const suite = page.getByRole("complementary", { name: "Test suite" });
  await expect(suite.getByText("Simulated examples", { exact: true })).toBeVisible();
  await expect(suite.getByRole("button")).toHaveCount(4);
  await expect(
    suite.getByRole("button", { name: /Booking changed after approval/ }),
  ).toBeVisible();
  await expect(
    suite.getByRole("button", { name: /Refund retried twice/ }),
  ).toBeVisible();
  await expect(
    suite.getByRole("button", { name: /Deploy said done, state unchanged/ }),
  ).toBeVisible();
  await expect(
    suite.getByRole("button", { name: /Post said live, stayed draft/ }),
  ).toBeVisible();
  await suite.getByRole("button", { name: /Post said live, stayed draft/ }).click();
  const staging = page.getByRole("region", { name: "Social Neuron staging check" });
  await expect(staging.getByText("OPTIONAL STAGING · DISABLED", { exact: true })).toBeVisible();
  await expect(staging.getByText("Optional staging integration", { exact: true })).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("runs visible approval and effect-ledger proof through registered tools", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  await expectWorkflowGuide(page, "Next actor: Agent", "stage");
  await expect(page.getByRole("region", { name: "Next actor: Agent" })).toContainText(
    "Send this instruction to your agent",
  );

  expect(await invokeRegisteredTool(page, "stage_refund_comparison")).toMatchObject({
    ok: true,
    phase: "awaiting_approval",
  });
  await expectWorkflowGuide(page, "Next actor: Human", "approve");
  await expect(page.getByRole("region", { name: "Next actor: Human" })).toContainText(
    "Agent is waiting",
  );
  const approvalRegion = page.getByRole("region", {
    name: "Exact staging refund fixture",
  });
  const approvalButton = page.getByRole("button", {
    name: "Approve exact staging refund",
  });
  await expect(approvalButton).toBeFocused();
  const approvalRegionBox = await approvalRegion.boundingBox();
  const approvalButtonBox = await approvalButton.boundingBox();
  expect(approvalRegionBox).not.toBeNull();
  expect(approvalButtonBox).not.toBeNull();
  expect(approvalButtonBox!.x).toBeGreaterThanOrEqual(0);
  expect(approvalButtonBox!.x + approvalButtonBox!.width).toBeLessThanOrEqual(1281);
  expect(approvalButtonBox!.x).toBeGreaterThanOrEqual(approvalRegionBox!.x - 1);
  expect(approvalButtonBox!.x + approvalButtonBox!.width).toBeLessThanOrEqual(
    approvalRegionBox!.x + approvalRegionBox!.width + 1,
  );
  expect(
    await approvalRegion.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);

  const exactInput = {
    paymentId: "pay-204",
    amountMinor: 4200,
    currency: "USD",
    requestId: "refund-request-204",
  } as const;
  expect(
    await invokeRegisteredTool(page, "issue_refund", {
      ...exactInput,
      lane: "broken",
    }),
  ).toMatchObject({
    ok: false,
    error: { code: "HUMAN_APPROVAL_REQUIRED" },
  });
  await expectWorkflowGuide(page, "Next actor: Human", "approve");

  const checkpoint = approvalRegion;
  await expect(checkpoint).toContainText("refund-comparison-1");
  await expect(checkpoint).toContainText("pay-204");
  await expect(checkpoint).toContainText("42.00 USD");
  await expect(checkpoint).toContainText("refund-request-204");
  await checkpoint.getByText("Show binding details").click();
  await expect(checkpoint).toContainText("v1:1:pay-204:4200:USD:refund-request-204");

  const exactPrompt = page.getByLabel("Agent prompt");
  await expect(exactPrompt).toContainText('lane "broken"');
  await expect(exactPrompt).toContainText('lane "protected"');
  await expect(exactPrompt).toContainText('paymentId "pay-204"');
  await expect(exactPrompt).toContainText("amountMinor 4200");
  await expect(exactPrompt).toContainText('currency "USD"');
  await expect(exactPrompt).toContainText('requestId "refund-request-204"');
  await expect(exactPrompt).toContainText("PROVIDER_ACK_LOST_AFTER_COMMIT");

  await approvalButton.click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  await expect(checkpoint).toBeFocused();
  await expectWorkflowGuide(page, "Next actor: Agent", "deliver");
  await expect(page.getByRole("region", { name: "Next actor: Agent" })).toContainText(
    "Return to your agent and say continue",
  );

  expect(
    await invokeRegisteredTool(page, "issue_refund", {
      ...exactInput,
      lane: "broken",
    }),
  ).toMatchObject({
    ok: false,
    error: { code: "PROVIDER_ACK_LOST_AFTER_COMMIT" },
  });
  await expectWorkflowGuide(page, "Next actor: Agent", "retry");

  expect(
    await invokeRegisteredTool(page, "issue_refund", {
      ...exactInput,
      lane: "broken",
    }),
  ).toMatchObject({ ok: true });
  await expectWorkflowGuide(page, "Next actor: Agent", "deliver");
  await expect(page.getByRole("region", { name: "Next actor: Agent" })).toContainText(
    "Run the remaining version",
  );

  expect(
    await invokeRegisteredTool(page, "issue_refund", {
      ...exactInput,
      lane: "protected",
    }),
  ).toMatchObject({
    ok: false,
    error: { code: "PROVIDER_ACK_LOST_AFTER_COMMIT" },
  });
  await expectWorkflowGuide(page, "Next actor: Agent", "retry");

  expect(
    await invokeRegisteredTool(page, "issue_refund", {
      ...exactInput,
      lane: "protected",
    }),
  ).toMatchObject({ ok: true });
  await expectWorkflowGuide(page, "Next actor: Agent", "prove");
  await expect(page.getByRole("region", { name: "Next actor: Agent" })).toContainText(
    "Verify the outcome",
  );

  expect(
    await invokeRegisteredTool(page, "prove_refund_comparison"),
  ).toMatchObject({
    ok: true,
    phase: "proof_ready",
    data: {
      proof: {
        broken: { attempts: 2, providerRefunds: 2 },
        protected: { attempts: 2, providerRefunds: 1 },
      },
    },
  });
  await expectWorkflowGuide(page, "Workflow complete", "complete");

  const proof = page.getByRole("region", {
    name: "Caught the unsafe duplicate. Protected stayed single.",
  });
  await expect(proof).toBeFocused();
  await expect(proof.getByText("Checker validated", { exact: true })).toBeVisible();
  await expect(proof).toContainText("2 calls → 2 effects");
  await expect(proof).toContainText("2 calls → 1 effect");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
});

test("runs the duplicate refund contract with one click", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("button", { name: /Refund retried twice/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Run test" }).click();

  const report = page.getByRole("region", {
    name: "Duplicate refund prevented",
  });
  await expect(report.getByText("PASS", { exact: true })).toBeVisible();
  await expect(
    report.getByText("Tool calls", { exact: true }).locator(".."),
  ).toContainText("2");
  await expect(
    report.getByText("Provider refunds", { exact: true }).locator(".."),
  ).toContainText("1");
  await expect(
    report.getByText("Final state", { exact: true }).locator(".."),
  ).toContainText("Refunded once");

  const readableResultSelectors = [
    ".report-verdict small",
    ".report-summary > p",
    ".result-split dt",
    ".result-split dd",
    ".report-metrics dt",
    ".report-metrics dd",
    ".event-trace h4",
    ".event-trace li",
    ".report-rule",
  ];
  for (const selector of readableResultSelectors) {
    const size = await report.locator(selector).first().evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
    expect(size, `${selector} should render at 12px or larger`).toBeGreaterThanOrEqual(12);
  }

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("proves the refund test catches a broken version before the safe version passes", async ({
  page,
}) => {
  await page.goto("/");

  await page
    .getByRole("button", { name: "Prove this test catches the bug" })
    .click();

  const caughtReport = page.getByRole("region", {
    name: "Broken behavior caught",
  });
  await expect(caughtReport.getByText("FAIL", { exact: true })).toBeVisible();
  await expect(
    caughtReport.getByText("Protection removed", { exact: true }).locator(".."),
  ).toContainText("Drop idempotency reuse");
  await expect(
    caughtReport.getByText("Sensitivity check", { exact: true }).locator(".."),
  ).toContainText("Passed");
  await expect(
    caughtReport.getByText("Provider refunds", { exact: true }).locator(".."),
  ).toContainText("2");

  const caughtAccessibility = await new AxeBuilder({ page }).analyze();
  expect(caughtAccessibility.violations).toEqual([]);

  await page.getByRole("button", { name: "Run safe version" }).click();
  const safeReport = page.getByRole("region", {
    name: "Duplicate refund prevented",
  });
  await expect(safeReport.getByText("PASS", { exact: true })).toBeVisible();
  await expect(
    safeReport.getByText("Provider refunds", { exact: true }).locator(".."),
  ).toContainText("1");
});

test("runs the broken-to-safe check from the keyboard", async ({ page }) => {
  await page.goto("/");

  const brokenButton = page.getByRole("button", {
    name: "Prove this test catches the bug",
    exact: true,
  });
  await brokenButton.focus();
  await expect(brokenButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "Broken behavior caught" }),
  ).toBeVisible();

  const safeButton = page.getByRole("button", {
    name: "Run safe version",
    exact: true,
  });
  await safeButton.focus();
  await expect(safeButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "Duplicate refund prevented" }),
  ).toBeVisible();
});

test("switches scenarios and distinguishes cloud conformance from outcome", async ({
  page,
}) => {
  await page.goto("/");

  const cloudScenario = page.getByRole("button", {
    name: /Deploy said done, state unchanged/,
  });
  await cloudScenario.click();
  await expect(cloudScenario).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Deploy said done, state unchanged",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Run test" }).click();

  const report = page.getByRole("region", {
    name: "False cloud success rejected",
  });
  await expect(report.getByText("PASS", { exact: true })).toBeVisible();
  await expect(
    report.getByText("Observed outcome", { exact: true }).locator(".."),
  ).toContainText("Unchanged — false success caught");
});
