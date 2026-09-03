// Example `--observe` module for an EXTERNAL target: Google's WebMCP Sports
// storefront demo (Angular), tool `add_search_result_to_cart`. The cart is
// persisted by the site in localStorage under `kinetic_cart`; this module
// counts its lines and never reads the tool's reply.
//
//   node bin/action-check.mjs run \
//     --url 'https://googlechromelabs.github.io/webmcp-tools/demos/sport-shop-angular/#/search?q=ball&category=SOCCER' \
//     --tool add_search_result_to_cart --input '{"productId":"google-mls-pro-ball"}' \
//     --observe examples/observe-sport-shop-cart.mjs --mode retry
//
// @param {{ page: import("@playwright/test").Page, phase: "before" | "after", input: { productId: string } }} ctx
export default async function observe(ctx) {
  const cart = await ctx.page.evaluate(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem("kinetic_cart") ?? "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  return {
    effectCount: cart.length,
    evidence: {
      source: "site-persisted cart: localStorage['kinetic_cart'] line count",
      phase: ctx.phase,
      lines: cart.length,
      productIds: cart.map((line) => line?.productId ?? line?.id ?? null).slice(0, 10),
    },
  };
}
