/**
 * Turns four fields a visitor types into the two artefacts they need to run
 * Action Check against their own page: an `observe()` module and the CLI
 * command that uses it.
 *
 * Everything here is pure string building. The browser cannot run the check
 * itself: WebMCP tools are registered on a page's own `document.modelContext`,
 * and a page has no way to reach the model context of a different origin. The
 * check has to drive a real Chrome from outside, which is what the CLI does.
 * So the page's job is to hand over a correct command, not to pretend it can
 * run one.
 */

export type CheckMode = "retry" | "once";

export interface CheckBuilderInput {
  url: string;
  tool: string;
  input: string;
  mode: CheckMode;
}

export interface CheckBuilderFieldError {
  field: "url" | "tool" | "input";
  message: string;
}

export const CHECK_BUILDER_DEFAULTS: CheckBuilderInput = Object.freeze({
  url: "https://googlechromelabs.github.io/webmcp-tools/demos/sport-shop-angular/#/search?q=ball&category=SOCCER",
  tool: "add_search_result_to_cart",
  input: '{"productId":"google-mls-pro-ball"}',
  mode: "retry",
});

/**
 * POSIX single-quoting. A single quote cannot appear inside a single-quoted
 * shell word, so it is closed, escaped and reopened. Without this a target URL
 * containing an apostrophe would silently produce a command that does
 * something other than what the page displays.
 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * A stable, filesystem-safe module name derived from the target's host, so two
 * different targets do not both suggest `observe-site.mjs`.
 */
export function observeModuleName(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }
  const slug = host
    .replace(/^www\./, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `observe-${slug || "my-target"}.mjs`;
}

export function validate(input: CheckBuilderInput): CheckBuilderFieldError[] {
  const errors: CheckBuilderFieldError[] = [];

  const url = input.url.trim();
  if (!url) {
    errors.push({ field: "url", message: "A target page URL is required." });
  } else {
    let parsed: URL | undefined;
    try {
      parsed = new URL(url);
    } catch {
      parsed = undefined;
    }
    if (!parsed) {
      errors.push({ field: "url", message: "That is not a URL Chrome can open." });
    } else if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      errors.push({ field: "url", message: "The URL has to be http or https." });
    }
  }

  const tool = input.tool.trim();
  if (!tool) {
    errors.push({ field: "tool", message: "A registered tool name is required." });
  } else if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(tool)) {
    errors.push({
      field: "tool",
      message: "Tool names are identifiers: letters, digits, underscore, dot or dash.",
    });
  }

  const raw = input.input.trim();
  if (!raw) {
    errors.push({ field: "input", message: "Input is required; use {} for a tool that takes none." });
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      errors.push({ field: "input", message: "Input has to be valid JSON." });
      parsed = undefined;
    }
    if (parsed !== undefined && (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))) {
      errors.push({ field: "input", message: "Input has to be a JSON object, like {\"id\":1}." });
    }
  }

  return errors;
}

/** Collapses typed JSON to one line so the emitted command is copy-pasteable. */
function compactJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw));
  } catch {
    return raw.trim();
  }
}

export function buildCommand(input: CheckBuilderInput): string {
  const url = input.url.trim();
  const tool = input.tool.trim();
  const json = compactJson(input.input);
  return [
    "node bin/action-check.mjs run \\",
    `  --url ${shellQuote(url)} \\`,
    `  --tool ${shellQuote(tool)} \\`,
    `  --input ${shellQuote(json)} \\`,
    `  --observe examples/${observeModuleName(url)} \\`,
    `  --mode ${input.mode}`,
  ].join("\n");
}

const MODE_NOTE: Record<CheckMode, string> = {
  retry:
    "// retry mode calls the tool twice with identical input. A pass needs exactly\n" +
    "// one new effect: zero is NO_EFFECT, two or more is DUPLICATE_EFFECT.",
  once:
    "// once mode calls the tool a single time and compares its claim against the\n" +
    "// delta: FALSE_SUCCESS, SILENT_EFFECT, EFFECT_CONFIRMED or HONEST_REFUSAL.",
};

export function buildObserveModule(input: CheckBuilderInput): string {
  const url = input.url.trim();
  const tool = input.tool.trim();
  const json = compactJson(input.input);
  const fileName = observeModuleName(url);

  return `// examples/${fileName}
//
// observe() for ${tool} on ${url || "your target page"}.
// Action Check calls this twice, before the first tool call and after the last,
// and takes the verdict from the difference between the two numbers.
//
${MODE_NOTE[input.mode]}
//
// The one rule: read a store the tool does not write into its own reply. This
// function is never given the tool's response, so it cannot echo the claim.
// If it could, the check would only be testing that the tool agrees with itself.
//
//   node bin/action-check.mjs run \\
//     --url ${shellQuote(url)} \\
//     --tool ${shellQuote(tool)} --input ${shellQuote(json)} \\
//     --observe examples/${fileName} --mode ${input.mode}
//
// @param {{ page: import("@playwright/test").Page, phase: "before" | "after", tool: string, input: unknown, pageOrigin: string }} ctx
export default async function observe(ctx) {
  // Replace this with a count of the thing ${tool} is supposed to create.
  // ctx.page is the live Playwright page, so any of these work:
  //
  //   rendered rows   await ctx.page.locator("[data-order-row]").count()
  //   the site's own store
  //                   await ctx.page.evaluate(() => JSON.parse(
  //                     localStorage.getItem("cart") ?? "[]").length)
  //   a read-only API  (await (await fetch(...)).json()).items.length
  //
  const effectCount = await ctx.page.locator("[data-effect-row]").count();

  return {
    effectCount,
    evidence: {
      source: "rendered [data-effect-row] elements on the target page",
      phase: ctx.phase,
      rows: effectCount,
    },
  };
}
`;
}
