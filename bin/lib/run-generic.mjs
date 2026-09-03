// External-target mode for `action-check`: drive ANY page's registered WebMCP
// tool in real Chrome and cross-check its claim against a caller-supplied
// observe() that reads the page's own state.
//
//   node bin/action-check.mjs run --url <page> --tool <name> --input '<json>' \
//        --observe <module.mjs> [--mode retry|once] [--settle-ms 1500] [--headed]
//
// observe(ctx) is called twice — before the first tool call and after the
// last — with { page, phase: "before" | "after", tool, input, pageOrigin }.
// `page` is the live Playwright page, so observe() can read the DOM, call a
// read-only tool through document.modelContext, or hit the site's API. It
// must return { effectCount: number, evidence?: unknown }. It is never handed
// the tool results, so it cannot echo the tool's claim.

import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { computeGenericVerdict } from "./generic-verdict.mjs";

class HarnessError extends Error {}

function log(...args) {
  console.error(...args);
}

async function loadObserveModule(observePath) {
  const absolute = path.resolve(process.cwd(), observePath);
  let mod;
  try {
    mod = await import(pathToFileURL(absolute).href);
  } catch (error) {
    throw new HarnessError(`Could not load --observe module at ${observePath}: ${error?.message ?? error}`);
  }
  if (typeof mod.default !== "function") {
    throw new HarnessError(
      `--observe module at ${observePath} must have a default export: observe(ctx) => Promise<{ effectCount, evidence? }>`,
    );
  }
  return mod.default;
}

async function observeOnce(observeFn, ctx) {
  let observed;
  try {
    observed = await observeFn(ctx);
  } catch (error) {
    throw new HarnessError(`observe() failed in phase "${ctx.phase}": ${error?.message ?? error}`);
  }
  if (!observed || typeof observed.effectCount !== "number" || !Number.isFinite(observed.effectCount)) {
    throw new HarnessError(`observe() must return { effectCount: number } in phase "${ctx.phase}"; got ${JSON.stringify(observed)}`);
  }
  return observed;
}

/**
 * Invoke a tool through the page's native model context. Chrome 152 expects
 * the input as JSON text; object input is tried second for newer builds.
 * Returns the tool's result, or { thrown } when executeTool rejected.
 */
async function invokeNative(page, toolName, input) {
  return page.evaluate(
    async ({ name, args }) => {
      const tools = await document.modelContext.getTools();
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) return { thrown: `Native WebMCP tool not found: ${name}` };
      const attempts = [JSON.stringify(args), args];
      let lastError;
      for (const candidate of attempts) {
        try {
          const result = await document.modelContext.executeTool(tool, candidate);
          if (typeof result === "string") {
            try {
              return JSON.parse(result);
            } catch {
              return result;
            }
          }
          return result === undefined ? null : result;
        } catch (error) {
          lastError = String(error?.message ?? error);
          if (!/parse input|JSON/i.test(lastError)) break;
        }
      }
      return { thrown: lastError ?? "executeTool rejected" };
    },
    { name: toolName, args: input },
  );
}

export async function runGeneric(options, { chromium }) {
  const mode = options.mode ?? "retry";
  if (mode !== "retry" && mode !== "once") {
    throw new HarnessError(`--mode must be "retry" or "once" (got "${mode}")`);
  }
  const settleMs = Number.isFinite(options.settleMs) ? options.settleMs : 1500;
  const observeFn = await loadObserveModule(options.observe);

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
    log(`[action-check] opening ${options.url}`);
    await page.goto(options.url, { waitUntil: "load" });

    const hasModelContext = await page.evaluate(
      () => "modelContext" in document && typeof document.modelContext?.getTools === "function",
    );
    if (!hasModelContext) {
      throw new HarnessError(
        `document.modelContext is unavailable on ${options.url} (Chrome ${chromeVersion}). The page must register native WebMCP tools in a top-level, origin-isolated document.`,
      );
    }

    let toolSurface;
    try {
      await page.waitForFunction(
        (name) => document.modelContext.getTools().then((tools) => tools.some((tool) => tool.name === name)),
        options.tool,
        { timeout: 15_000 },
      );
      toolSurface = await page.evaluate(async (name) => {
        const tools = await document.modelContext.getTools();
        const tool = tools.find((candidate) => candidate.name === name);
        return {
          registered: tools.map((candidate) => candidate.name),
          description: tool?.description ?? "",
          inputSchema: typeof tool?.inputSchema === "string" ? tool.inputSchema : JSON.stringify(tool?.inputSchema ?? null),
          annotations: tool?.annotations ?? null,
        };
      }, options.tool);
    } catch (error) {
      const registered = await page
        .evaluate(() => document.modelContext.getTools().then((tools) => tools.map((tool) => tool.name)))
        .catch(() => []);
      throw new HarnessError(
        `Tool "${options.tool}" was not registered on ${options.url} within 15s. Registered tools: ${registered.join(", ") || "(none)"}. ${error?.message ?? ""}`,
      );
    }
    log(`[action-check] registered tools: ${toolSurface.registered.join(", ")}`);
    log(`[action-check] target tool "${options.tool}": ${toolSurface.description}`);

    const pageOrigin = new URL(options.url).origin;
    const baseCtx = { page, tool: options.tool, input: options.input, pageOrigin };

    const before = await observeOnce(observeFn, { ...baseCtx, phase: "before" });
    log(`[action-check] observe(before) -> effectCount ${before.effectCount}`);

    const calls = [];
    const callCount = mode === "retry" ? 2 : 1;
    for (let attempt = 1; attempt <= callCount; attempt += 1) {
      log(`[action-check] ${options.tool}(${JSON.stringify(options.input)}) attempt ${attempt}/${callCount}`);
      let result;
      try {
        result = await invokeNative(page, options.tool, options.input);
      } catch (error) {
        const message = String(error?.message ?? error);
        if (/context or browser has been closed|Execution context was destroyed|Target closed/i.test(message)) {
          throw new HarnessError(
            `Tool "${options.tool}" navigated or replaced the document during execution, so the page state cannot be observed in place. External-target mode v0.1 supports tools that keep the document alive (imperative tools and non-navigating forms); declarative tools that submit and navigate are not supported yet.`,
          );
        }
        throw error;
      }
      calls.push(result);
      const brief = typeof result === "string" ? result.slice(0, 160) : JSON.stringify(result).slice(0, 160);
      log(`[action-check]   -> ${brief}`);
      await page.waitForTimeout(settleMs);
    }

    const after = await observeOnce(observeFn, { ...baseCtx, phase: "after" });
    log(`[action-check] observe(after) -> effectCount ${after.effectCount}`);

    const verdict = computeGenericVerdict({ mode, calls, before, after });
    log(`[action-check] verdict: ${verdict.status} ${verdict.code} -- ${verdict.reason}`);

    return {
      version: "v0.1-external-target",
      url: options.url,
      tool: options.tool,
      input: options.input,
      mode,
      chromeVersion,
      toolSurface,
      before,
      calls,
      after,
      verdict,
      generatedAt: new Date().toISOString(),
    };
  } finally {
    await browser.close();
  }
}

export { HarnessError as GenericHarnessError };
