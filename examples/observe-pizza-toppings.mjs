// Example `--observe` module for an EXTERNAL target: Google's WebMCP zaMaker
// demo (https://googlechromelabs.github.io/webmcp-tools/demos/pizza-maker/).
//
// The tool under test is `add_topping` or `remove_topping`. This module never
// sees the tool's reply; it counts the topping elements actually rendered on
// the pizza for the topping named in the input. That rendered state is what
// the person looking at the page would see, which is the effect Action Check
// measures.
//
// Example runs:
//   node bin/action-check.mjs run \
//     --url https://googlechromelabs.github.io/webmcp-tools/demos/pizza-maker/ \
//     --tool add_topping --input '{"topping":"🍍","count":1}' \
//     --observe examples/observe-pizza-toppings.mjs --mode retry
//   node bin/action-check.mjs run \
//     --url https://googlechromelabs.github.io/webmcp-tools/demos/pizza-maker/ \
//     --tool remove_topping --input '{"topping":"🍍"}' \
//     --observe examples/observe-pizza-toppings.mjs --mode once
//
// @param {{ page: import("@playwright/test").Page, phase: "before" | "after", tool: string, input: { topping: string } }} ctx
// @returns {Promise<{ effectCount: number, evidence: unknown }>}
export default async function observe(ctx) {
  const topping = ctx.input?.topping;
  if (typeof topping !== "string") {
    throw new Error("observe-pizza-toppings: input.topping must be a string");
  }
  const rendered = await ctx.page.evaluate((emoji) => {
    const nodes = [...document.querySelectorAll("#pizza-container .topping")];
    const matching = nodes.filter((node) => node.getAttribute("data-emoji") === emoji);
    return {
      matching: matching.length,
      total: nodes.length,
      size: document.querySelector("#size-text")?.textContent?.trim() ?? null,
    };
  }, topping);

  return {
    effectCount: rendered.matching,
    evidence: {
      source: "rendered DOM: #pizza-container .topping[data-emoji]",
      phase: ctx.phase,
      topping,
      matchingToppings: rendered.matching,
      totalToppings: rendered.total,
      pizzaSize: rendered.size,
    },
  };
}
