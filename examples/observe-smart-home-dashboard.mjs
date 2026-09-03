// Example `--observe` module for an EXTERNAL target: Google's WebMCP Smart
// Home demo (https://googlechromelabs.github.io/webmcp-tools/demos/smart-home/#/),
// tool `rearrangeDOMComponents`. The tool replies "Dashboard successfully
// updated with requested components." This module never reads that reply; it
// counts the component cards actually rendered in the dashboard grid, which
// is what the person looking at the page sees.
//
//   # false-success probe: an unknown component id
//   node bin/action-check.mjs run \
//     --url 'https://googlechromelabs.github.io/webmcp-tools/demos/smart-home/#/' \
//     --tool rearrangeDOMComponents --input '{"componentIds":["nonexistent_widget"]}' \
//     --observe examples/observe-smart-home-dashboard.mjs --mode once
//   # positive control: two real components
//   node bin/action-check.mjs run \
//     --url 'https://googlechromelabs.github.io/webmcp-tools/demos/smart-home/#/' \
//     --tool rearrangeDOMComponents --input '{"componentIds":["thermostat_control","camera_front_door"]}' \
//     --observe examples/observe-smart-home-dashboard.mjs --mode once
//
// @param {{ page: import("@playwright/test").Page, phase: "before" | "after", input: { componentIds: string[] } }} ctx
export default async function observe(ctx) {
  const rendered = await ctx.page.evaluate(() => document.querySelectorAll(".bento-grid > div").length);
  return {
    effectCount: rendered,
    evidence: {
      source: "rendered DOM: .bento-grid > div (dashboard component cards)",
      phase: ctx.phase,
      requestedComponentIds: ctx.input?.componentIds ?? [],
      renderedComponents: rendered,
    },
  };
}
