#!/usr/bin/env node
// Off-script agent-recovery probes for the refund-comparison fixture.
//
// Drives the deployed page's native WebMCP tools in real Chrome (with the
// WebMCP flag) through the calls a language-model agent might plausibly make
// that the scripted journey never does: prove before staging, issue before
// approval, double staging, wrong or malformed arguments, a third delivery,
// prove too early, re-staging mid-flight, and non-JSON input. The yardstick
// is Chrome's WebMCP guidance to fail gracefully and enable recovery: every
// off-script call must come back with a structured error carrying `code`,
// `message`, and `nextAction`, and nothing may corrupt the trial silently.
//
// Usage: node scripts/agent-recovery-probes.mjs <out.json> [page-url]
// Requires Chrome 149+ installed (channel "chrome"). Results are printed
// one line per call and written as JSON to <out.json>.
import { chromium } from "@playwright/test";
import fs from "node:fs";
const URL = process.argv[3] ?? "https://action-check-webmcp.vercel.app/";
const OUT = process.argv[2];
const FIX = { paymentId: "pay-204", amountMinor: 4200, currency: "USD", requestId: "refund-request-204" };
const NAMES = ["stage_refund_comparison", "issue_refund", "prove_refund_comparison"];
const log = [];
function rec(session, step, tool, input, result, guide) {
  const entry = { session, step, tool, input, result, guide };
  log.push(entry);
  const r = typeof result === "object" && result ? result : { raw: result };
  const code = r.error?.code ?? (r.ok === true ? "ok" : r.thrown ? "THROWN" : "?");
  console.log(`[${session}] ${step} ${tool}(${JSON.stringify(input)}) -> ok=${r.ok} code=${code}` +
    (r.error?.message ? ` | msg="${r.error.message}"` : "") +
    (r.error?.nextAction ? ` | next="${r.error.nextAction}"` : "") +
    (r.thrown ? ` | thrown="${r.thrown}"` : "") +
    (guide ? ` | page: [${guide.action}] ${guide.title}` : ""));
}
async function newSession(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction((names) => document.modelContext.getTools().then(ts => { const h = new Set(ts.map(t => t.name)); return names.every(n => h.has(n)); }), NAMES, { timeout: 15000 });
  const mode = await page.evaluate(async () => {
    const tools = await document.modelContext.getTools();
    const t = tools.find(x => x.name === "prove_refund_comparison");
    try { await document.modelContext.executeTool(t, {}); return "object"; } catch { return "json-text"; }
  });
  const call = async (name, args, rawInput) => {
    try {
      const out = await page.evaluate(async ({ name, args, mode, rawInput }) => {
        const tools = await document.modelContext.getTools();
        const t = tools.find(x => x.name === name);
        if (!t) return { thrown: `tool not found: ${name}` };
        const input = rawInput !== undefined ? rawInput : (mode === "object" ? args : JSON.stringify(args));
        try { return await document.modelContext.executeTool(t, input); }
        catch (e) { return { thrown: String(e?.message ?? e) }; }
      }, { name, args, mode, rawInput });
      return typeof out === "string" ? JSON.parse(out) : out;
    } catch (e) { return { thrown: String(e?.message ?? e) }; }
  };
  const guide = async () => page.evaluate(() => {
    const el = document.querySelector("[data-next-action]");
    return el ? { action: el.getAttribute("data-next-action"), title: el.querySelector("h3")?.textContent?.trim(), progress: el.querySelector("small")?.textContent?.trim() } : null;
  });
  const approve = async () => { await page.getByRole("button", { name: "Approve exact staging refund" }).click(); await page.getByText("Approved", { exact: true }).waitFor({ state: "visible", timeout: 10000 }); };
  return { page, ctx, mode, call, guide, approve };
}

const browser = await chromium.launch({ channel: "chrome", args: ["--enable-features=WebMCP"], headless: true });
try {
  // ---------- S1: pre-approval, schema, over-limit ----------
  let s = await newSession(browser); let S = "S1";
  console.log(`[${S}] input mode: ${s.mode}`);
  rec(S, "a prove-before-stage", "prove_refund_comparison", {}, await s.call("prove_refund_comparison", {}), await s.guide());
  rec(S, "b issue-before-stage", "issue_refund", { lane: "broken", ...FIX }, await s.call("issue_refund", { lane: "broken", ...FIX }), await s.guide());
  const staged = await s.call("stage_refund_comparison", {});
  rec(S, "c stage", "stage_refund_comparison", {}, staged, await s.guide());
  console.log(`[${S}] c stage FULL RESULT: ${JSON.stringify(staged)}`);
  rec(S, "d stage-again-before-approval", "stage_refund_comparison", {}, await s.call("stage_refund_comparison", {}), await s.guide());
  rec(S, "e issue-before-approval", "issue_refund", { lane: "broken", ...FIX }, await s.call("issue_refund", { lane: "broken", ...FIX }), await s.guide());
  await s.approve(); console.log(`[${S}] approved`);
  rec(S, "f wrong-requestId", "issue_refund", { lane: "broken", ...FIX, requestId: "refund-request-999" }, await s.call("issue_refund", { lane: "broken", ...FIX, requestId: "refund-request-999" }), await s.guide());
  rec(S, "g wrong-amount", "issue_refund", { lane: "broken", ...FIX, amountMinor: 4300 }, await s.call("issue_refund", { lane: "broken", ...FIX, amountMinor: 4300 }), await s.guide());
  const missing = { lane: "broken", paymentId: FIX.paymentId, amountMinor: FIX.amountMinor, requestId: FIX.requestId };
  rec(S, "h missing-currency", "issue_refund", missing, await s.call("issue_refund", missing), await s.guide());
  rec(S, "i extra-property", "issue_refund", { lane: "broken", ...FIX, note: "x" }, await s.call("issue_refund", { lane: "broken", ...FIX, note: "x" }), await s.guide());
  rec(S, "j amount-as-string", "issue_refund", { lane: "broken", ...FIX, amountMinor: "4200" }, await s.call("issue_refund", { lane: "broken", ...FIX, amountMinor: "4200" }), await s.guide());
  rec(S, "k lane-uppercase", "issue_refund", { lane: "Broken", ...FIX }, await s.call("issue_refund", { lane: "Broken", ...FIX }), await s.guide());
  for (const lane of ["broken", "protected"]) for (let i = 1; i <= 2; i++)
    rec(S, `l ${lane}#${i}`, "issue_refund", { lane, ...FIX }, await s.call("issue_refund", { lane, ...FIX }), await s.guide());
  rec(S, "m third-call-broken", "issue_refund", { lane: "broken", ...FIX }, await s.call("issue_refund", { lane: "broken", ...FIX }), await s.guide());
  const proof = await s.call("prove_refund_comparison", {});
  rec(S, "n prove", "prove_refund_comparison", {}, proof, await s.guide());
  console.log(`[${S}] n prove FULL RESULT (${JSON.stringify(proof).length} chars): ${JSON.stringify(proof).slice(0, 1800)}`);
  rec(S, "o prove-again", "prove_refund_comparison", {}, await s.call("prove_refund_comparison", {}), await s.guide());
  rec(S, "p issue-after-proof", "issue_refund", { lane: "protected", ...FIX }, await s.call("issue_refund", { lane: "protected", ...FIX }), await s.guide());
  rec(S, "q stage-after-proof", "stage_refund_comparison", {}, await s.call("stage_refund_comparison", {}), await s.guide());
  await s.ctx.close();

  // ---------- S2: re-stage after approval, mid-flight ----------
  s = await newSession(browser); S = "S2";
  rec(S, "a stage", "stage_refund_comparison", {}, await s.call("stage_refund_comparison", {}), await s.guide());
  await s.approve(); console.log(`[${S}] approved`);
  rec(S, "b broken#1", "issue_refund", { lane: "broken", ...FIX }, await s.call("issue_refund", { lane: "broken", ...FIX }), await s.guide());
  rec(S, "c RE-STAGE mid-flight", "stage_refund_comparison", {}, await s.call("stage_refund_comparison", {}), await s.guide());
  rec(S, "d broken after re-stage", "issue_refund", { lane: "broken", ...FIX }, await s.call("issue_refund", { lane: "broken", ...FIX }), await s.guide());
  rec(S, "e prove after re-stage", "prove_refund_comparison", {}, await s.call("prove_refund_comparison", {}), await s.guide());
  await s.ctx.close();

  // ---------- S3: prove too early, then finish ----------
  s = await newSession(browser); S = "S3";
  rec(S, "a stage", "stage_refund_comparison", {}, await s.call("stage_refund_comparison", {}), await s.guide());
  await s.approve(); console.log(`[${S}] approved`);
  rec(S, "b broken#1", "issue_refund", { lane: "broken", ...FIX }, await s.call("issue_refund", { lane: "broken", ...FIX }), await s.guide());
  rec(S, "c prove-after-1-call", "prove_refund_comparison", {}, await s.call("prove_refund_comparison", {}), await s.guide());
  rec(S, "d broken#2", "issue_refund", { lane: "broken", ...FIX }, await s.call("issue_refund", { lane: "broken", ...FIX }), await s.guide());
  rec(S, "e prove-after-2-calls", "prove_refund_comparison", {}, await s.call("prove_refund_comparison", {}), await s.guide());
  rec(S, "f protected#1", "issue_refund", { lane: "protected", ...FIX }, await s.call("issue_refund", { lane: "protected", ...FIX }), await s.guide());
  rec(S, "g protected#2", "issue_refund", { lane: "protected", ...FIX }, await s.call("issue_refund", { lane: "protected", ...FIX }), await s.guide());
  rec(S, "h prove", "prove_refund_comparison", {}, await s.call("prove_refund_comparison", {}), await s.guide());
  await s.ctx.close();

  // ---------- S4: raw malformed inputs at the executeTool boundary ----------
  s = await newSession(browser); S = "S4";
  rec(S, "a stage", "stage_refund_comparison", {}, await s.call("stage_refund_comparison", {}), await s.guide());
  await s.approve();
  rec(S, "b not-json-text", "issue_refund", "garbage", await s.call("issue_refund", {}, "not json at all"), await s.guide());
  rec(S, "c stage-with-extra-input", "stage_refund_comparison", { foo: 1 }, await s.call("stage_refund_comparison", { foo: 1 }), await s.guide());
  await s.ctx.close();
} finally {
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(log, null, 2));
  console.log(`wrote ${OUT} (${log.length} entries)`);
}
