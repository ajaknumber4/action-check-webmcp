import { expect, test } from "@playwright/test";

/**
 * Exercises the in-page simulated-agent path added for visitors without a
 * WebMCP-capable browser. Unlike tests/e2e/workbench.spec.ts, this suite
 * does NOT install a fake document.modelContext — native WebMCP stays
 * genuinely unavailable, exactly like a real judge's browser, so the
 * primary "Run with a simulated agent" launcher is the only way to see the
 * refund comparison proof. All four documented steps (stage, human
 * approval, two retried lanes, prove) still run against the same staging
 * Worker the native path uses (see playwright.config.ts's webServer, which
 * starts the real Worker code via local `wrangler dev` on :8787).
 */

test.setTimeout(60_000);

test("runs the simulated agent path end to end against the real staging Worker", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto("/");

  // Native WebMCP is genuinely unavailable in a plain browser — the primary
  // fallback is the only path to the proof.
  await expect(
    page.locator(".refund-proof-registration").getByText("Unavailable in this browser"),
  ).toBeVisible();

  const launcher = page.getByRole("button", { name: "Run with a simulated agent" });
  await expect(launcher).toBeVisible();

  await launcher.click();

  // The badge appears the moment the simulated driver owns a staged trial,
  // and stays up through the whole run.
  await expect(
    page.getByText(
      "Simulated agent · no WebMCP client connected · tools called in-page",
    ),
  ).toBeVisible({ timeout: 15_000 });

  // The approval step is a REAL click — the driver only waits for it.
  const approvalButton = page.getByRole("button", {
    name: "Approve exact staging refund",
  });
  await expect(approvalButton).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("region", { name: "Exact staging refund fixture" }),
  ).toContainText("pay-204");
  await approvalButton.click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();

  // From here the driver runs unattended: broken lane x2, protected lane
  // x2, then prove_refund_comparison — all real staging Worker round trips.
  await expect(page.getByRole("region", { name: "Workflow complete" })).toBeVisible({
    timeout: 30_000,
  });

  const result = page.getByRole("region", {
    name: "Caught the unsafe duplicate. Protected stayed single.",
  });
  await expect(result).toContainText("2 calls → 2 effects");
  await expect(result).toContainText("2 calls → 1 effect");
  await expect(result).toContainText(
    "WebMCP discovery was not exercised in this run",
  );

  // Every simulated-agent action is labelled as such in its own event
  // trace, distinct from the workbench's native contract event trace.
  const trace = page.getByRole("list", { name: "Simulated agent event trace" });
  const traceRows = trace.getByRole("listitem");
  await expect(traceRows).toHaveCount(7);
  for (const row of await traceRows.all()) {
    await expect(row).toContainText("simulated");
  }
  await expect(page.getByRole("button", { name: "Run again" })).toBeVisible();

  // No horizontal overflow at a 375px viewport with the badge, launcher,
  // and full trace all rendered.
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(
    page.getByText(
      "Simulated agent · no WebMCP client connected · tools called in-page",
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
});

test("offers the simulated path as a secondary comparison option when WebMCP is available", async ({
  page,
}) => {
  // A minimal fake document.modelContext, mirroring the fixture in
  // tests/e2e/workbench.spec.ts, just enough to flip native registration
  // to "ready" so the launcher renders as the secondary comparison option.
  await page.addInitScript(() => {
    Object.defineProperty(document, "modelContext", {
      value: {
        async registerTool() {
          // Registration succeeding is all this test needs; no tool call
          // is invoked through it.
        },
      },
      configurable: true,
    });
  });
  await page.goto("/");

  await expect(
    page.locator(".refund-proof-registration").getByText("Native WebMCP ready"),
  ).toBeVisible();
  const launcher = page.getByRole("button", { name: "Run with a simulated agent" });
  await expect(launcher).toBeVisible();
  await expect(launcher).toHaveClass(/refund-proof-simulate-button-secondary/);
});
