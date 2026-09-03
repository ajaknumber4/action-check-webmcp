// Example `--observe` module for an EXTERNAL target: Google's WebMCP zaMaker
// demo, tool `set_pizza_size`. A "set" tool should be safe to retry: calling
// it twice with the same size must leave the page in that size exactly once,
// not error and not flip. effectCount is 1 when the rendered size label
// equals the requested size, else 0.
//
//   node bin/action-check.mjs run \
//     --url https://googlechromelabs.github.io/webmcp-tools/demos/pizza-maker/ \
//     --tool set_pizza_size --input '{"size":"Large"}' \
//     --observe examples/observe-pizza-size.mjs --mode retry
//
// @param {{ page: import("@playwright/test").Page, phase: "before" | "after", input: { size: string } }} ctx
export default async function observe(ctx) {
  const wanted = ctx.input?.size;
  const rendered = await ctx.page.evaluate(
    () => document.querySelector("#size-text")?.textContent?.trim() ?? null,
  );
  return {
    effectCount: rendered === wanted ? 1 : 0,
    evidence: { source: "rendered DOM: #size-text", phase: ctx.phase, wanted, rendered },
  };
}
