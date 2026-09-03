// Static record of external-target CLI runs against public WebMCP demo pages
// that Action Check does not own. Each row mirrors one proof JSON in
// docs/evidence/external-targets-2026-09-03/. This is a record of recorded
// runs, not a live check: the page never re-runs them.

export const REPO_URL = "https://github.com/ajaknumber4/action-check-webmcp";
export const EVIDENCE_URL = `${REPO_URL}/tree/main/docs/evidence/external-targets-2026-09-03`;
export const EXTERNAL_TARGET_RUNS_DATE = "3 September 2026";
export const EXTERNAL_TARGET_CHROME = "Chrome 152 with WebMCP enabled";

export const EXTERNAL_TARGET_COMMAND = [
  "node bin/action-check.mjs run \\",
  "  --url 'https://googlechromelabs.github.io/webmcp-tools/demos/smart-home/#/' \\",
  "  --tool rearrangeDOMComponents --input '{\"componentIds\":[\"nonexistent_widget\"]}' \\",
  "  --observe examples/observe-smart-home-dashboard.mjs --mode once",
].join("\n");

export type ExternalTargetRun = Readonly<{
  id: string;
  demo: string;
  pageUrl: string;
  tool: string;
  input: string;
  mode: "retry" | "once";
  observed: string;
  before: number;
  after: number;
  status: "PASS" | "FAIL";
  code: string;
  evidenceFile: string;
}>;

const SMART_HOME = "https://googlechromelabs.github.io/webmcp-tools/demos/smart-home/#/";
const SPORT_SHOP =
  "https://googlechromelabs.github.io/webmcp-tools/demos/sport-shop-angular/#/search?q=ball&category=SOCCER";
const PIZZA_MAKER = "https://googlechromelabs.github.io/webmcp-tools/demos/pizza-maker/";
const TICKET_BOOKING = "https://googlechromelabs.github.io/webmcp-tools/demos/ticket-booking/";
const TICKET_BOOKING_MOVIE = "https://googlechromelabs.github.io/webmcp-tools/demos/ticket-booking/#movie/101";
const LEATHER_BAG =
  "https://googlechromelabs.github.io/webmcp-tools/demos/leather-bag/#/product/signature-satchel";
const ANALYTICS = "https://googlechromelabs.github.io/webmcp-tools/demos/analytics-dashboard/";
const EXPLAINER = "https://googlechromelabs.github.io/webmcp-tools/demos/explainer/";

export const EXTERNAL_TARGET_RUNS: readonly ExternalTargetRun[] = Object.freeze([
  {
    id: "shop-retry",
    demo: "Sports storefront",
    pageUrl: SPORT_SHOP,
    tool: "add_search_result_to_cart",
    input: '{"productId":"google-mls-pro-ball"}',
    mode: "retry",
    observed: "cart lines the site stores in localStorage",
    before: 0,
    after: 2,
    status: "FAIL",
    code: "DUPLICATE_EFFECT",
    evidenceFile: "shop-retry.json",
  },
  {
    id: "smart-false",
    demo: "Smart Home",
    pageUrl: SMART_HOME,
    tool: "rearrangeDOMComponents",
    input: '{"componentIds":["nonexistent_widget"]}',
    mode: "once",
    observed: "dashboard cards rendered on the page",
    before: 1,
    after: 0,
    status: "FAIL",
    code: "FALSE_SUCCESS",
    evidenceFile: "smart-false.json",
  },
  {
    id: "smart-valid",
    demo: "Smart Home",
    pageUrl: SMART_HOME,
    tool: "rearrangeDOMComponents",
    input: '{"componentIds":["thermostat_control","camera_front_door"]}',
    mode: "once",
    observed: "dashboard cards rendered on the page",
    before: 1,
    after: 2,
    status: "PASS",
    code: "EFFECT_CONFIRMED",
    evidenceFile: "smart-valid.json",
  },
  {
    id: "add-topping",
    demo: "zaMaker",
    pageUrl: PIZZA_MAKER,
    tool: "add_topping",
    input: '{"topping":"🍍","count":1}',
    mode: "retry",
    observed: "🍍 toppings rendered on the pizza",
    before: 0,
    after: 2,
    status: "FAIL",
    code: "DUPLICATE_EFFECT",
    evidenceFile: "add_topping.json",
  },
  {
    id: "remove-topping",
    demo: "zaMaker",
    pageUrl: PIZZA_MAKER,
    tool: "remove_topping",
    input: '{"topping":"🍍"}',
    mode: "once",
    observed: "🍍 toppings rendered on the pizza",
    before: 0,
    after: 0,
    status: "PASS",
    code: "HONEST_REFUSAL",
    evidenceFile: "remove_topping.json",
  },
  {
    id: "set-size",
    demo: "zaMaker",
    pageUrl: PIZZA_MAKER,
    tool: "set_pizza_size",
    input: '{"size":"Large"}',
    mode: "retry",
    observed: "the rendered size label",
    before: 0,
    after: 1,
    status: "PASS",
    code: "IDEMPOTENT",
    evidenceFile: "set_pizza_size.json",
  },
  {
    id: "ticket-select-valid",
    demo: "Ticket booking",
    pageUrl: TICKET_BOOKING_MOVIE,
    tool: "select_showtime",
    input: '{"movie_id":"101","date":"2026-09-04","time":"10:00 AM"}',
    mode: "once",
    observed: "the checkout section shown on the page",
    before: 0,
    after: 0,
    status: "FAIL",
    code: "FALSE_SUCCESS",
    evidenceFile: "ticket-select-valid.json",
  },
  {
    id: "ticket-select-invalid",
    demo: "Ticket booking",
    pageUrl: TICKET_BOOKING,
    tool: "select_showtime",
    input: '{"movie_id":"nope","date":"2026-09-03","time":"10:00 AM"}',
    mode: "once",
    observed: "the checkout section shown on the page",
    before: 0,
    after: 0,
    status: "PASS",
    code: "HONEST_REFUSAL",
    evidenceFile: "ticket-select-invalid.json",
  },
  {
    id: "ticket-location",
    demo: "Ticket booking",
    pageUrl: TICKET_BOOKING,
    tool: "update_location",
    input: '{"city":"Paris"}',
    mode: "retry",
    observed: "the rendered location label",
    before: 0,
    after: 1,
    status: "PASS",
    code: "IDEMPOTENT",
    evidenceFile: "ticket-location-retry.json",
  },
  {
    id: "leather-add",
    demo: "Luxe Leather",
    pageUrl: LEATHER_BAG,
    tool: "add_to_cart",
    input: '{"variations":[{"color":"Brown","quantity":1}]}',
    mode: "retry",
    observed: "line quantities on the site’s own cart page",
    before: 0,
    after: 2,
    status: "FAIL",
    code: "DUPLICATE_EFFECT",
    evidenceFile: "leather-add-retry.json",
  },
  {
    id: "analytics-query",
    demo: "Analytics dashboard",
    pageUrl: ANALYTICS,
    tool: "query",
    input: '{"groupBy":"status","measure":"count","chartType":"bar_horizontal"}',
    mode: "retry",
    observed: "the three chart controls on the page",
    before: 0,
    after: 1,
    status: "PASS",
    code: "IDEMPOTENT",
    evidenceFile: "analytics-query-retry.json",
  },
  {
    id: "explainer-cancel",
    demo: "Explainer",
    pageUrl: EXPLAINER,
    tool: "cancelBooking",
    input: '{"confirmationId":"BK-NOPE00"}',
    mode: "once",
    observed: "the confirmed-booking banner",
    before: 0,
    after: 0,
    status: "PASS",
    code: "HONEST_REFUSAL",
    evidenceFile: "explainer-cancel-invalid.json",
  },
]);

export const EXTERNAL_TARGET_KNOWN_LIMIT =
  "Le Petit Bistro's declarative booking tool navigates on submit and replaces the document mid-call; the CLI reports that as a harness error, not a verdict.";
