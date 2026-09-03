// Example `--observe` module for an EXTERNAL target: Google's WebMCP explainer
// demo (https://googlechromelabs.github.io/webmcp-tools/demos/explainer/),
// tools `bookSlot` and `cancelBooking`. The page has two booking widgets; only
// `#widget-with` is driven by the registered tools. This module never reads
// the tool's reply; it counts the visible "Booked!" confirmation in that
// widget (0 or 1) and records the confirmation id it shows.
//
//   # retry: booking the same slot twice must leave exactly one confirmation
//   node bin/action-check.mjs run \
//     --url https://googlechromelabs.github.io/webmcp-tools/demos/explainer/ \
//     --tool bookSlot --input '{"date":"2026-09-08","time":"14:00","name":"Action Check","email":"qa@example.com"}' \
//     --observe examples/observe-explainer-booking.mjs --mode retry
//   # once: cancelling an id that was never issued must not change anything
//   node bin/action-check.mjs run \
//     --url https://googlechromelabs.github.io/webmcp-tools/demos/explainer/ \
//     --tool cancelBooking --input '{"confirmationId":"BK-NOPE00"}' \
//     --observe examples/observe-explainer-booking.mjs --mode once
//
// @param {{ page: import("@playwright/test").Page, phase: "before" | "after", input: unknown }} ctx
export default async function observe(ctx) {
  const rendered = await ctx.page.evaluate(() => {
    const el = document.querySelector("#widget-with .w-success");
    const visible = Boolean(el && el.classList.contains("is-visible") && /Booked!/.test(el.textContent ?? ""));
    return {
      visible,
      text: el?.textContent?.trim() ?? null,
      confirmationId: el?.querySelector("code")?.textContent?.trim() ?? null,
    };
  });
  return {
    effectCount: rendered.visible ? 1 : 0,
    evidence: {
      source: "rendered DOM: #widget-with .w-success.is-visible (confirmed booking banner)",
      phase: ctx.phase,
      input: ctx.input,
      bannerText: rendered.text,
      confirmationId: rendered.confirmationId,
    },
  };
}
