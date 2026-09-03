// Example `--observe` module for an EXTERNAL target: Google's WebMCP analytics
// dashboard demo (https://googlechromelabs.github.io/webmcp-tools/demos/analytics-dashboard/),
// tool `query`. The tool sets the dashboard's group-by, measure and chart-type
// controls in one call. A "set" tool should be safe to retry: effectCount is 1
// when all three rendered <select> controls equal the requested values, else
// 0. Selects are found by their option sets, not their position.
//
//   node bin/action-check.mjs run \
//     --url https://googlechromelabs.github.io/webmcp-tools/demos/analytics-dashboard/ \
//     --tool query --input '{"groupBy":"status","measure":"count","chartType":"bar_horizontal"}' \
//     --observe examples/observe-analytics-query.mjs --mode retry
//
// @param {{ page: import("@playwright/test").Page, phase: "before" | "after", input: { groupBy: string, measure: string, chartType: string } }} ctx
export default async function observe(ctx) {
  const wanted = { groupBy: ctx.input?.groupBy, measure: ctx.input?.measure, chartType: ctx.input?.chartType };
  const rendered = await ctx.page.evaluate(() => {
    const selects = [...document.querySelectorAll("select")];
    const withOption = (value) => selects.find((s) => [...s.options].some((o) => o.value === value));
    return {
      groupBy: withOption("user_agent")?.value ?? null,
      measure: withOption("unique_ips")?.value ?? null,
      chartType: withOption("bar_horizontal")?.value ?? null,
    };
  });
  const matches = rendered.groupBy === wanted.groupBy && rendered.measure === wanted.measure && rendered.chartType === wanted.chartType;
  return {
    effectCount: matches ? 1 : 0,
    evidence: {
      source: "rendered DOM: group-by, measure and chart-type <select> values equal the request",
      phase: ctx.phase,
      wanted,
      rendered,
    },
  };
}
