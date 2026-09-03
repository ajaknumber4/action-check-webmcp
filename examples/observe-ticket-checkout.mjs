// Example `--observe` module for an EXTERNAL target: Google's WebMCP ticket
// booking demo (https://googlechromelabs.github.io/webmcp-tools/demos/ticket-booking/),
// tool `select_showtime`. A successful selection reveals `#checkout-section`
// (the site toggles its `hidden` class). This module reports 1 when that
// section is visible and never reads the tool's reply.
//
//   # once, false-success probe: a movie id the catalogue does not have
//   node bin/action-check.mjs run \
//     --url 'https://googlechromelabs.github.io/webmcp-tools/demos/ticket-booking/' \
//     --tool select_showtime --input '{"movie_id":"nope","date":"2026-09-03","time":"10:00 AM"}' \
//     --observe examples/observe-ticket-checkout.mjs --mode once
//   # once, positive control: open the movie first so checkout starts in place
//   node bin/action-check.mjs run \
//     --url 'https://googlechromelabs.github.io/webmcp-tools/demos/ticket-booking/#movie/101' \
//     --tool select_showtime --input '{"movie_id":"101","date":"2026-09-04","time":"10:00 AM"}' \
//     --observe examples/observe-ticket-checkout.mjs --mode once
//
// @param {{ page: import("@playwright/test").Page, phase: "before" | "after", input: { movie_id: string, date: string, time: string } }} ctx
export default async function observe(ctx) {
  const rendered = await ctx.page.evaluate(() => {
    const section = document.getElementById("checkout-section");
    return {
      visible: Boolean(section && !section.classList.contains("hidden")),
      checkoutTime: document.getElementById("checkout-time")?.textContent?.trim() ?? null,
      hash: location.hash,
    };
  });
  return {
    effectCount: rendered.visible ? 1 : 0,
    evidence: {
      source: "rendered DOM: #checkout-section without class 'hidden'",
      phase: ctx.phase,
      input: ctx.input,
      checkoutVisible: rendered.visible,
      checkoutTime: rendered.checkoutTime,
      hash: rendered.hash,
    },
  };
}
