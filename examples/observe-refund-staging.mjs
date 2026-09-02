// Example `--observe` module for `bin/action-check.mjs`.
//
// This reads the refund-staging Worker's own append-only ledger through its
// `/v1/observe` endpoint -- a store the WebMCP tool never writes back into
// its own response. It never reads the tool's claims. That separation is
// the entire point: `action-check` distrusts a tool's self-reported success
// and cross-checks it against an independent record.
//
// The Worker enforces the same origin allowlist for this endpoint as it does
// for browser requests (see workers/refund-staging-target/src/index.ts), so
// this direct server-to-server call must still present an `Origin` header
// that is on that allowlist. `ctx.pageOrigin` (the origin of the page the
// CLI drove) is exactly that value for the default local fixture.
//
// @param {{ lane: "broken" | "protected", run: unknown, targetBaseUrl: string, pageOrigin?: string }} ctx
// @returns {Promise<{ effectCount: number, effectIds: string[], evidenceDigest: string, observedAt: string }>}
export default async function observe(ctx) {
  const origin = ctx.pageOrigin ?? "http://127.0.0.1:4173";
  const response = await fetch(`${ctx.targetBaseUrl}/v1/observe`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({ run: ctx.run }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `observe-refund-staging: POST ${ctx.targetBaseUrl}/v1/observe returned ${response.status}: ${body}`,
    );
  }

  const body = await response.json();
  if (!Array.isArray(body.effectIds)) {
    throw new Error("observe-refund-staging: response did not include effectIds");
  }

  return {
    effectCount: body.effectIds.length,
    effectIds: body.effectIds,
    evidenceDigest: body.evidenceDigest,
    observedAt: body.observedAt,
  };
}
