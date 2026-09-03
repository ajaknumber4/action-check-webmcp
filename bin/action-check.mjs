#!/usr/bin/env node
// action-check v0 -- headless WebMCP retry-safety CLI.
//
// Drives the installed real Chrome (never the Playwright-bundled Chromium)
// against a page that registers native WebMCP tools, performs the human
// approval step itself, invokes `issue_refund` twice per lane with an
// identical request ID, and cross-checks the tool's own claims against an
// independently observed effect count supplied by an `--observe` module.
// v0 supports exactly one fixture: the refund-comparison staging demo.
//
// Usage:
//   node bin/action-check.mjs run \
//     --url <page> \
//     --tool issue_refund \
//     --observe <module.mjs> \
//     [--request-id refund-request-204] \
//     [--headed] \
//     [--target-base-url http://127.0.0.1:8787]
//
// Exit codes: 0 PASS, 1 FAIL, 2 harness/usage error.

import { chromium } from "@playwright/test";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { computeVerdict } from "./lib/verdict.mjs";

const SUPPORTED_TOOL = "issue_refund";
const FIXTURE_TOOL_NAMES = Object.freeze([
  "stage_refund_comparison",
  "issue_refund",
  "prove_refund_comparison",
]);
const FIXTURE_PAYMENT_ID = "pay-204";
const FIXTURE_AMOUNT_MINOR = 4200;
const FIXTURE_CURRENCY = "USD";
const DEFAULT_REQUEST_ID = "refund-request-204";
const DEFAULT_TARGET_BASE_URL = "http://127.0.0.1:8787";
const LANES = Object.freeze(["broken", "protected"]);

class UsageError extends Error {}
class HarnessError extends Error {}

function log(...args) {
  console.error(...args);
}

function usage() {
  return [
    "Usage: node bin/action-check.mjs run --url <page> --tool issue_refund --observe <module.mjs>",
    "                                      [--request-id refund-request-204] [--headed]",
    "                                      [--target-base-url http://127.0.0.1:8787]",
    "",
    "v0 supports exactly one fixture: the refund-comparison staging demo's issue_refund tool.",
  ].join("\n");
}

function parseArgs(argv) {
  if (argv[0] !== "run") {
    throw new UsageError(`Unknown or missing subcommand "${argv[0] ?? ""}".\n\n${usage()}`);
  }
  const rest = argv.slice(1);
  const options = {
    url: undefined,
    tool: undefined,
    observe: undefined,
    requestId: DEFAULT_REQUEST_ID,
    headed: false,
    targetBaseUrl: DEFAULT_TARGET_BASE_URL,
  };

  const takeValue = (flag, index) => {
    const value = rest[index];
    if (value === undefined || value.startsWith("--")) {
      throw new UsageError(`Missing value for ${flag}.\n\n${usage()}`);
    }
    return value;
  };

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    switch (arg) {
      case "--url":
        options.url = takeValue(arg, i + 1);
        i += 1;
        break;
      case "--tool":
        options.tool = takeValue(arg, i + 1);
        i += 1;
        break;
      case "--observe":
        options.observe = takeValue(arg, i + 1);
        i += 1;
        break;
      case "--request-id":
        options.requestId = takeValue(arg, i + 1);
        i += 1;
        break;
      case "--target-base-url":
        options.targetBaseUrl = takeValue(arg, i + 1);
        i += 1;
        break;
      case "--headed":
        options.headed = true;
        break;
      default:
        throw new UsageError(`Unknown flag "${arg}".\n\n${usage()}`);
    }
  }

  for (const [flag, key] of [
    ["--url", "url"],
    ["--tool", "tool"],
    ["--observe", "observe"],
  ]) {
    if (!options[key]) {
      throw new UsageError(`Missing required flag ${flag}.\n\n${usage()}`);
    }
  }

  if (options.tool !== SUPPORTED_TOOL) {
    throw new UsageError(
      `v0 only supports --tool ${SUPPORTED_TOOL} (got "${options.tool}"). ${usage()}`,
    );
  }

  return options;
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new HarnessError(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function loadObserveModule(observePath) {
  const absolute = path.resolve(process.cwd(), observePath);
  let mod;
  try {
    mod = await import(pathToFileURL(absolute).href);
  } catch (error) {
    throw new HarnessError(
      `Could not load --observe module at ${observePath}: ${error?.message ?? error}`,
    );
  }
  if (typeof mod.default !== "function") {
    throw new HarnessError(
      `--observe module at ${observePath} must have a default export: observe(ctx) => Promise<{ effectCount, effectIds, evidenceDigest, observedAt }>`,
    );
  }
  return mod.default;
}

async function detectInputMode(page) {
  return page.evaluate(async () => {
    const modelContext = document.modelContext;
    const nativeTools = await modelContext.getTools();
    const proofTool = nativeTools.find((candidate) => candidate.name === "prove_refund_comparison");
    if (!proofTool) throw new Error("Native proof tool not found");
    try {
      await modelContext.executeTool(proofTool, {});
      return "object";
    } catch {
      return "json-text";
    }
  });
}

async function invokeTool(page, toolName, input, inputMode) {
  const invocation = await page.evaluate(
    async ({ name, args, inputMode: mode }) => {
      const modelContext = document.modelContext;
      const nativeTools = await modelContext.getTools();
      const tool = nativeTools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`Native WebMCP tool not found: ${name}`);
      return await modelContext.executeTool(tool, mode === "object" ? args : JSON.stringify(args));
    },
    { name: toolName, args: input, inputMode },
  );
  return typeof invocation === "string" ? JSON.parse(invocation) : invocation;
}

async function run(options) {
  const browser = await chromium.launch({
    channel: "chrome",
    args: ["--enable-features=WebMCP"],
    headless: !options.headed,
  });
  const chromeVersion = browser.version();
  log(`[action-check] launched real Chrome ${chromeVersion} (channel: chrome, --enable-features=WebMCP)`);

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Registered BEFORE staging so the page's own POST to */v1/reset is
    // captured directly -- the stage tool's own `data` field does not carry
    // the run bindings (runId, leaseExpiresAt, attestationDigest) needed to
    // call /v1/observe independently.
    //
    // This intercepts the request via page.route() and refetches it through
    // Playwright's own network stack (route.fetch()) rather than reading the
    // body off the `response` event: Chrome's CDP-backed response body cache
    // for a fast local fetch can already be evicted by the time
    // `response.json()` is called, which intermittently throws "Response
    // body is not available for a response that was navigated away from"
    // even with no navigation involved. route.fetch()'s body is fully
    // buffered in Node, so it does not race with that cache.
    let resolveReset;
    let rejectReset;
    const resetPromise = new Promise((resolve, reject) => {
      resolveReset = resolve;
      rejectReset = reject;
    });
    // A capture failure must surface via withTimeout(resetPromise) below, not
    // as an unhandled rejection while stage_refund_comparison is still awaiting.
    resetPromise.catch(() => {});
    let resetCaptured = false;
    await page.route("**/v1/reset", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      try {
        const response = await route.fetch();
        const body = await response.json();
        if (!resetCaptured) {
          resetCaptured = true;
          resolveReset(body);
        }
        await route.fulfill({ response });
      } catch (error) {
        if (!resetCaptured) {
          resetCaptured = true;
          rejectReset(error);
        }
        await route.abort().catch(() => {});
      }
    });

    log(`[action-check] opening ${options.url}`);
    await page.goto(options.url, { waitUntil: "load" });

    const modelContextInfo = await page.evaluate(() => ({
      hasModelContext: "modelContext" in document,
      registerToolType: typeof document.modelContext?.registerTool,
    }));
    if (!modelContextInfo.hasModelContext || modelContextInfo.registerToolType !== "function") {
      throw new HarnessError(
        [
          "document.modelContext is unavailable on this page.",
          `Chrome version: ${chromeVersion}`,
          'Hint: this requires real Chrome 149+ launched with channel:"chrome" and the --enable-features=WebMCP flag (this CLI already launches that way). Confirm the target page actually mounts native WebMCP tool registration.',
        ].join("\n"),
      );
    }

    const cdp = await context.newCDPSession(page);
    const trace = { toolsAdded: [], toolResponded: [] };
    let resolveFirstToolsAdded;
    const firstToolsAddedPromise = new Promise((resolve) => {
      resolveFirstToolsAdded = resolve;
    });
    cdp.on("WebMCP.toolsAdded", (payload) => {
      trace.toolsAdded.push(payload);
      resolveFirstToolsAdded();
    });
    cdp.on("WebMCP.toolResponded", (payload) => {
      trace.toolResponded.push(payload);
    });
    await cdp.send("WebMCP.enable");
    await withTimeout(
      firstToolsAddedPromise,
      10_000,
      "Did not observe a WebMCP.toolsAdded CDP event within 10s of enabling the session.",
    );
    log(`[action-check] CDP WebMCP domain enabled, ${trace.toolsAdded[0]?.tools?.length ?? 0} tool(s) reported`);

    // Registration of the three fixture tools is asynchronous; the first
    // WebMCP.toolsAdded CDP snapshot can legitimately arrive before all
    // three have registered (observed: "2 tool(s) reported" on a fresh
    // page load). document.modelContext.getTools() is the source of truth
    // actually used by invokeTool()/detectInputMode(), so wait on that
    // directly -- mirrors the native spec's readiness barrier (it waits for
    // the "Native WebMCP ready" region before touching tools).
    try {
      await page.waitForFunction(
        (names) =>
          document.modelContext.getTools().then((tools) => {
            const have = new Set(tools.map((tool) => tool.name));
            return names.every((name) => have.has(name));
          }),
        FIXTURE_TOOL_NAMES,
        { timeout: 10_000 },
      );
    } catch (error) {
      throw new HarnessError(
        `Did not observe all fixture tools (${FIXTURE_TOOL_NAMES.join(", ")}) registered on document.modelContext within 10s: ${error?.message ?? error}`,
      );
    }

    const inputMode = await detectInputMode(page);
    log(`[action-check] native executeTool input mode: ${inputMode}`);

    log("[action-check] staging comparison (stage_refund_comparison)");
    await invokeTool(page, "stage_refund_comparison", {}, inputMode);

    const reset = await withTimeout(
      resetPromise,
      15_000,
      "Did not observe the page's own POST to */v1/reset. Check --target-base-url and that the staging Worker is reachable from the page.",
    );
    const runs = reset.runs;
    if (!runs || !runs.broken || !runs.protected) {
      throw new HarnessError("The captured /v1/reset response did not include runs.broken and runs.protected.");
    }
    log(`[action-check] captured run bindings for lanes: ${Object.keys(runs).join(", ")}`);

    log('[action-check] approving on the operator\'s behalf: clicking "Approve exact staging refund" (v0 performs this click itself)');
    await page.getByRole("button", { name: "Approve exact staging refund" }).click();
    await page.getByText("Approved", { exact: true }).waitFor({ state: "visible" });
    log("[action-check] approved");

    const pageOrigin = new URL(options.url).origin;
    const observeFn = await loadObserveModule(options.observe);

    const lanes = {};
    for (const lane of LANES) {
      const calls = [];
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const input = {
          lane,
          paymentId: FIXTURE_PAYMENT_ID,
          amountMinor: FIXTURE_AMOUNT_MINOR,
          currency: FIXTURE_CURRENCY,
          requestId: options.requestId,
        };
        log(`[action-check] issue_refund lane=${lane} attempt=${attempt} requestId=${options.requestId}`);
        const result = await invokeTool(page, "issue_refund", input, inputMode);
        calls.push(result);
        if (result?.ok === false && result?.error?.code === "INPUT_MISMATCH") {
          throw Object.assign(
            new Error(
              `issue_refund reported INPUT_MISMATCH for lane=${lane}. v0 only supports the fixture request id ("${DEFAULT_REQUEST_ID}"); --request-id "${options.requestId}" does not match the approved trial.`,
            ),
            { exitCode: 1 },
          );
        }
      }

      log(`[action-check] observing lane=${lane} via ${options.observe}`);
      let observed;
      try {
        observed = await observeFn({
          lane,
          run: runs[lane],
          targetBaseUrl: options.targetBaseUrl,
          pageOrigin,
        });
      } catch (error) {
        throw new HarnessError(
          `observe() failed for lane=${lane} against ${options.targetBaseUrl}: ${error?.message ?? error}. If the page talks to a deployed staging target, pass --target-base-url <that origin>; the default is the local worker.`,
        );
      }
      lanes[lane] = { calls, observed };
    }

    let pageProof;
    try {
      pageProof = await invokeTool(page, "prove_refund_comparison", {}, inputMode);
    } catch (error) {
      pageProof = { ok: false, error: { code: "PAGE_PROOF_UNAVAILABLE", message: String(error?.message ?? error) } };
    }

    const verdict = computeVerdict({ lanes });
    log(`[action-check] verdict: ${verdict.status} -- ${verdict.reason}`);

    const proof = {
      version: "v0",
      url: options.url,
      tool: options.tool,
      requestId: options.requestId,
      chromeVersion,
      lanes,
      pageProof,
      trace,
      verdict,
      generatedAt: new Date().toISOString(),
    };

    return proof;
  } finally {
    await browser.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const proof = await run(options);
  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
  process.exit(proof.verdict.status === "PASS" ? 0 : 1);
}

main().catch((error) => {
  if (error instanceof UsageError) {
    log(error.message);
    process.exit(2);
  }
  if (typeof error?.exitCode === "number") {
    log(error.message);
    process.exit(error.exitCode);
  }
  log("[action-check] harness error:", error?.stack ?? error);
  process.exit(2);
});
