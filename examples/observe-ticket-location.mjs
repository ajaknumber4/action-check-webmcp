// Example `--observe` module for an EXTERNAL target: Google's WebMCP ticket
// booking demo (https://googlechromelabs.github.io/webmcp-tools/demos/ticket-booking/),
// tool `update_location`. A "set" tool should be safe to retry: two identical
// calls must leave the header showing the requested city exactly once.
// effectCount is 1 when `#location-text` equals the requested city, else 0.
//
//   node bin/action-check.mjs run \
//     --url 'https://googlechromelabs.github.io/webmcp-tools/demos/ticket-booking/' \
//     --tool update_location --input '{"city":"Paris"}' \
//     --observe examples/observe-ticket-location.mjs --mode retry
//
// @param {{ page: import("@playwright/test").Page, phase: "before" | "after", input: { city: string } }} ctx
export default async function observe(ctx) {
  const wanted = ctx.input?.city;
  const rendered = await ctx.page.evaluate(() => ({
    locationText: document.getElementById("location-text")?.textContent?.trim() ?? null,
    movieCount: document.getElementById("movie-count")?.textContent?.trim() ?? null,
    search: location.search,
  }));
  return {
    effectCount: rendered.locationText === wanted ? 1 : 0,
    evidence: {
      source: "rendered DOM: #location-text equals requested city",
      phase: ctx.phase,
      wanted,
      rendered: rendered.locationText,
      movieCount: rendered.movieCount,
      urlSearch: rendered.search,
    },
  };
}
