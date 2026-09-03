// Example `--observe` module for an EXTERNAL target: Google's WebMCP Luxe
// Leather storefront demo (Angular), product page tool `add_to_cart`. The
// cart lives in memory (no localStorage). The header badge only counts cart
// LINES, so it cannot tell "quantity 1" from "quantity 2" of the same bag.
// This module therefore reads the real quantity: it hops to the `#/cart`
// route (same document, the Angular router keeps the in-memory cart), sums
// the line quantities, and returns to the product route before the tool is
// called again. It never reads the tool's reply.
//
//   node bin/action-check.mjs run \
//     --url 'https://googlechromelabs.github.io/webmcp-tools/demos/leather-bag/#/product/signature-satchel' \
//     --tool add_to_cart --input '{"variations":[{"color":"Brown","quantity":1}]}' \
//     --observe examples/observe-leather-cart-badge.mjs --mode retry
//
// @param {{ page: import("@playwright/test").Page, phase: "before" | "after", tool: string, input: unknown }} ctx
export default async function observe(ctx) {
  const { page } = ctx;
  const productUrl = page.url();
  const badgeText = await page.evaluate(() => document.querySelector(".cart-badge")?.textContent?.trim() ?? null);

  await page.evaluate(() => { location.hash = "#/cart"; });
  await page.waitForTimeout(1200);
  const cart = await page.evaluate(() => {
    const text = (document.querySelector("main") ?? document.body).innerText.replace(/\s+/g, " ").trim();
    // Each line renders "remove <qty> add"; sum the quantities.
    const quantities = [...text.matchAll(/remove\s+(\d+)\s+add/g)].map((m) => Number(m[1]));
    const subtotal = text.match(/Subtotal\s+\$([\d,]+\.\d{2})/)?.[1] ?? null;
    return { quantities, subtotal, empty: /bag is empty|no items/i.test(text) };
  });

  await page.goto(productUrl, { waitUntil: "load" });
  await page.waitForFunction(
    (name) => document.modelContext.getTools().then((tools) => tools.some((tool) => tool.name === name)),
    ctx.tool,
    { timeout: 15_000 },
  );

  const totalQuantity = cart.quantities.reduce((sum, q) => sum + q, 0);
  return {
    effectCount: totalQuantity,
    evidence: {
      source: "rendered DOM on the #/cart route: sum of line quantities (header .cart-badge recorded alongside)",
      phase: ctx.phase,
      input: ctx.input,
      badgeText,
      lineQuantities: cart.quantities,
      subtotal: cart.subtotal,
    },
  };
}
