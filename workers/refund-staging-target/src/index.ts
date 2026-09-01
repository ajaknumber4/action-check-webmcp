import { DurableObject } from "cloudflare:workers";

const API_PATHS = [
  "/v1/reset",
  "/v1/invoke",
  "/v1/observe",
  "/v1/cleanup",
] as const;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const MAX_BODY_BYTES = 16_384;
const MAX_TTL_SECONDS = 3_600;
const MIN_TTL_SECONDS = 60;
const SERVICE = "action-check-refund-staging" as const;

export type RefundLane = "broken" | "protected";

export type RefundTrialRef = Readonly<{
  trialId: string;
  epoch: number;
  digest: string;
}>;

export type IssueRefundInput = Readonly<{
  lane: RefundLane;
  paymentId: string;
  amountMinor: number;
  currency: string;
  requestId: string;
}>;

export type RefundTargetAttestation = Readonly<{
  service: typeof SERVICE;
  environment: "staging";
  deploymentId: string;
  capability: "refund-retry-effect-v1";
  store: "durable";
  attestationDigest: string;
}>;

export type RefundTargetRun = Readonly<{
  runId: string;
  lane: RefundLane;
  requestId: string;
  trialDigest: string;
  leaseExpiresAt: string;
  attestationDigest: string;
}>;

export type RefundTargetObservation = Readonly<{
  runId: string;
  lane: RefundLane;
  sequence: number;
  effectCount: number;
  effectIds: readonly string[];
  evidenceDigest: string;
  observedAt: string;
  source: "external-refund-staging";
}>;

export type RefundTargetReset = Readonly<{
  attestation: RefundTargetAttestation;
  runs: Readonly<Record<RefundLane, RefundTargetRun>>;
  baseline: Readonly<Record<RefundLane, RefundTargetObservation>>;
}>;

export type RefundTargetInvokeClaim = Readonly<{
  runId: string;
  requestId: string;
  claim: "created" | "reused" | "ack_lost";
}>;

type RunBinding = Readonly<{
  capabilityHash: string;
  lane: RefundLane;
  requestId: string;
  trialDigest: string;
  leaseExpiresAt: string;
  attestationDigest: string;
}>;

type InitializeInput = RunBinding &
  Readonly<{
    expiresAt: number;
  }>;

type InvokeInput = Readonly<{
  run: RunBinding;
  effect: IssueRefundInput;
  now: number;
}>;

type ObserveInput = Readonly<{
  run: RunBinding;
  now: number;
}>;

type Snapshot = Readonly<{
  lane: RefundLane;
  sequence: number;
  effectIds: readonly string[];
  evidenceDigest: string;
  observedAt: string;
}>;

type RpcErrorCode =
  | "CAPABILITY_EXPIRED"
  | "CALL_LIMIT_REACHED"
  | "INPUT_MISMATCH"
  | "RUN_ALREADY_INITIALIZED"
  | "RUN_MISMATCH"
  | "RUN_NOT_FOUND";

type RpcResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false;
      error: Readonly<{ code: RpcErrorCode; message: string }>;
    }>;

type SessionRow = Readonly<{
  capability_hash: string;
  lane: RefundLane;
  request_id: string;
  trial_digest: string;
  lease_expires_at: string;
  attestation_digest: string;
  expires_at: number;
  sequence: number;
  payment_id: string | null;
  amount_minor: number | null;
  currency: string | null;
}>;

type EffectRow = Readonly<{
  effect_id: string;
  invocation_sequence: number;
  request_id: string;
  payment_id: string;
  amount_minor: number;
  currency: string;
  created_at: number;
}>;

export class RefundRunState extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ensureSchema();
    });
  }

  async initialize(input: InitializeInput, now: number): Promise<RpcResult<Snapshot>> {
    this.ensureSchema();
    if (this.readSession()) {
      return failure(
        "RUN_ALREADY_INITIALIZED",
        "This opaque capability is already bound to a staging run.",
      );
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO session (
        singleton,
        capability_hash,
        lane,
        request_id,
        trial_digest,
        lease_expires_at,
        attestation_digest,
        expires_at,
        sequence
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 0)`,
      input.capabilityHash,
      input.lane,
      input.requestId,
      input.trialDigest,
      input.leaseExpiresAt,
      input.attestationDigest,
      input.expiresAt,
    );
    await this.ctx.storage.setAlarm(input.expiresAt);
    return success(await this.snapshot(now));
  }

  async invoke(input: InvokeInput): Promise<RpcResult<{ claim: RefundTargetInvokeClaim["claim"] }>> {
    this.ensureSchema();
    const active = this.validateActiveRun(input.run, input.now);
    if (!active.ok) return active;

    const session = active.value;
    if (session.sequence >= 2) {
      return failure(
        "CALL_LIMIT_REACHED",
        "This staging capability allows exactly two mutation attempts.",
      );
    }
    if (input.effect.lane !== session.lane || input.effect.requestId !== session.request_id) {
      return failure(
        "INPUT_MISMATCH",
        "The mutation does not match the exact lane and request ID bound at reset.",
      );
    }

    if (session.payment_id === null) {
      this.ctx.storage.sql.exec(
        `UPDATE session
         SET payment_id = ?, amount_minor = ?, currency = ?
         WHERE singleton = 1`,
        input.effect.paymentId,
        input.effect.amountMinor,
        input.effect.currency,
      );
    } else if (
      session.payment_id !== input.effect.paymentId ||
      session.amount_minor !== input.effect.amountMinor ||
      session.currency !== input.effect.currency
    ) {
      return failure(
        "INPUT_MISMATCH",
        "A retry cannot change the payment, amount, or currency bound by the first attempt.",
      );
    }

    const invocationSequence = session.sequence + 1;
    const existingProtectedEffect =
      session.lane === "protected"
        ? this.ctx.storage.sql
            .exec<{ effect_id: string }>(
              `SELECT effect_id
               FROM effects
               WHERE request_id = ?
               ORDER BY invocation_sequence ASC
               LIMIT 1`,
              input.effect.requestId,
            )
            .toArray()[0]
        : undefined;
    const created = existingProtectedEffect === undefined;

    if (created) {
      this.ctx.storage.sql.exec(
        `INSERT INTO effects (
          effect_id,
          lane,
          invocation_sequence,
          request_id,
          payment_id,
          amount_minor,
          currency,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        crypto.randomUUID(),
        session.lane,
        invocationSequence,
        input.effect.requestId,
        input.effect.paymentId,
        input.effect.amountMinor,
        input.effect.currency,
        input.now,
      );
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO invocations (sequence, request_id, created_effect, invoked_at)
       VALUES (?, ?, ?, ?)`,
      invocationSequence,
      input.effect.requestId,
      created ? 1 : 0,
      input.now,
    );
    this.ctx.storage.sql.exec(
      "UPDATE session SET sequence = ? WHERE singleton = 1",
      invocationSequence,
    );

    return success({
      claim:
        invocationSequence === 1
          ? "ack_lost"
          : created
            ? "created"
            : "reused",
    });
  }

  async observe(input: ObserveInput): Promise<RpcResult<Snapshot>> {
    this.ensureSchema();
    const active = this.validateActiveRun(input.run, input.now);
    if (!active.ok) return active;
    return success(await this.snapshot(input.now));
  }

  async cleanup(input: RunBinding): Promise<RpcResult<null>> {
    this.ensureSchema();
    const session = this.readSession();
    if (!session) {
      await this.ctx.storage.deleteAll();
      return success(null);
    }
    const matches = this.validateRunBinding(input, session);
    if (!matches.ok) return matches;

    // Cleanup remains available after lease expiry so test data can always be removed.
    await this.ctx.storage.deleteAll();
    return success(null);
  }

  override async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  private ensureSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS session (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        capability_hash TEXT NOT NULL,
        lane TEXT NOT NULL CHECK (lane IN ('broken', 'protected')),
        request_id TEXT NOT NULL,
        trial_digest TEXT NOT NULL,
        lease_expires_at TEXT NOT NULL,
        attestation_digest TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        sequence INTEGER NOT NULL DEFAULT 0 CHECK (sequence BETWEEN 0 AND 2),
        payment_id TEXT,
        amount_minor INTEGER,
        currency TEXT
      );
      CREATE TABLE IF NOT EXISTS effects (
        effect_id TEXT PRIMARY KEY,
        lane TEXT NOT NULL CHECK (lane IN ('broken', 'protected')),
        invocation_sequence INTEGER NOT NULL,
        request_id TEXT NOT NULL,
        payment_id TEXT NOT NULL,
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_protected_effect_per_request
        ON effects(request_id)
        WHERE lane = 'protected';
      CREATE TABLE IF NOT EXISTS invocations (
        sequence INTEGER PRIMARY KEY,
        request_id TEXT NOT NULL,
        created_effect INTEGER NOT NULL CHECK (created_effect IN (0, 1)),
        invoked_at INTEGER NOT NULL
      );
    `);
  }

  private readSession(): SessionRow | null {
    return (
      this.ctx.storage.sql
        .exec<SessionRow>(
          `SELECT
            capability_hash,
            lane,
            request_id,
            trial_digest,
            lease_expires_at,
            attestation_digest,
            expires_at,
            sequence,
            payment_id,
            amount_minor,
            currency
           FROM session
           WHERE singleton = 1`,
        )
        .toArray()[0] ?? null
    );
  }

  private validateActiveRun(run: RunBinding, now: number): RpcResult<SessionRow> {
    const session = this.readSession();
    if (!session) {
      return failure("RUN_NOT_FOUND", "The staging run does not exist or was cleaned up.");
    }
    const matches = this.validateRunBinding(run, session);
    if (!matches.ok) return matches;
    if (now >= session.expires_at) {
      return failure("CAPABILITY_EXPIRED", "The staging capability lease has expired.");
    }
    return success(session);
  }

  private validateRunBinding(run: RunBinding, session: SessionRow): RpcResult<SessionRow> {
    if (!timingSafeEqual(run.capabilityHash, session.capability_hash)) {
      return failure("RUN_MISMATCH", "The staging capability does not match this run.");
    }
    if (
      run.lane !== session.lane ||
      run.requestId !== session.request_id ||
      run.trialDigest !== session.trial_digest ||
      run.leaseExpiresAt !== session.lease_expires_at ||
      run.attestationDigest !== session.attestation_digest
    ) {
      return failure("RUN_MISMATCH", "The supplied run metadata is not bound to this capability.");
    }
    return success(session);
  }

  private async snapshot(now: number): Promise<Snapshot> {
    const session = this.readSession();
    if (!session) throw new Error("snapshot_without_session");
    const effects = this.ctx.storage.sql
      .exec<EffectRow>(
        `SELECT
          effect_id,
          invocation_sequence,
          request_id,
          payment_id,
          amount_minor,
          currency,
          created_at
         FROM effects
         ORDER BY invocation_sequence ASC, effect_id ASC`,
      )
      .toArray();
    const canonicalEvidence = JSON.stringify({
      schema: "action-check-refund-evidence-v1",
      runKey: session.capability_hash,
      lane: session.lane,
      requestId: session.request_id,
      trialDigest: session.trial_digest,
      attestationDigest: session.attestation_digest,
      sequence: session.sequence,
      effects: effects.map((effect) => ({
        effectId: effect.effect_id,
        invocationSequence: effect.invocation_sequence,
        requestId: effect.request_id,
        paymentId: effect.payment_id,
        amountMinor: effect.amount_minor,
        currency: effect.currency,
        createdAt: effect.created_at,
      })),
    });
    return {
      lane: session.lane,
      sequence: session.sequence,
      effectIds: effects.map(({ effect_id }) => effect_id),
      evidenceDigest: await sha256Digest(canonicalEvidence),
      observedAt: new Date(now).toISOString(),
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    let allowedOrigin: string | null = null;

    try {
      allowedOrigin = resolveAllowedOrigin(request.headers.get("Origin"), env.ALLOWED_ORIGINS);
      if (!allowedOrigin) {
        return jsonError(403, "ORIGIN_NOT_ALLOWED", "The request origin is not allowlisted.");
      }
      if (!API_PATHS.some((path) => path === url.pathname)) {
        return jsonError(404, "NOT_FOUND", "No staging endpoint exists at this path.", allowedOrigin);
      }
      if (request.method === "OPTIONS") {
        return handlePreflight(request, allowedOrigin);
      }
      if (request.method !== "POST") {
        return jsonError(405, "METHOD_NOT_ALLOWED", "Use POST for this endpoint.", allowedOrigin, {
          Allow: "POST, OPTIONS",
        });
      }
      if (!isJsonContentType(request.headers.get("Content-Type"))) {
        return jsonError(
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "Use application/json.",
          allowedOrigin,
        );
      }

      if (url.pathname === "/v1/reset") {
        const rateLimit = await env.RESET_RATE_LIMITER.limit({
          key: `refund-reset-origin:${allowedOrigin}`,
        });
        if (!rateLimit.success) {
          return jsonError(
            429,
            "RESET_RATE_LIMITED",
            "Too many staging runs were requested from this app origin.",
            allowedOrigin,
            { "Retry-After": "10" },
          );
        }
      }

      const decoded = await readBoundedJson(request);
      if (url.pathname === "/v1/reset") {
        return jsonResponse(await handleReset(decoded, env), 200, allowedOrigin);
      }
      if (url.pathname === "/v1/invoke") {
        return jsonResponse(await handleInvoke(decoded, env), 200, allowedOrigin);
      }
      if (url.pathname === "/v1/observe") {
        return jsonResponse(await handleObserve(decoded, env), 200, allowedOrigin);
      }
      await handleCleanup(decoded, env);
      return emptyResponse(204, allowedOrigin);
    } catch (error: unknown) {
      if (error instanceof HttpError) {
        return jsonError(error.status, error.code, error.message, allowedOrigin);
      }
      console.error(
        JSON.stringify({
          message: "refund staging request failed",
          path: url.pathname,
          requestId,
          error: error instanceof Error ? error.message : "unknown_error",
        }),
      );
      return jsonError(
        500,
        "INTERNAL_ERROR",
        "The staging target could not complete the request.",
        allowedOrigin,
      );
    }
  },
} satisfies ExportedHandler<Env>;

async function handleReset(decoded: unknown, env: Env): Promise<RefundTargetReset> {
  const input = parseResetRequest(decoded);
  const ttlSeconds = parseTtl(env.CAPABILITY_TTL_SECONDS);
  const now = Date.now();
  const expiresAt = now + ttlSeconds * 1_000;
  const leaseExpiresAt = new Date(expiresAt).toISOString();
  const attestation = await createAttestation(env.DEPLOYMENT_ID);

  const [broken, protectedRun] = await Promise.all([
    createRun("broken", input, leaseExpiresAt, expiresAt, now, attestation, env),
    createRun("protected", input, leaseExpiresAt, expiresAt, now, attestation, env),
  ]);

  return {
    attestation,
    runs: { broken: broken.run, protected: protectedRun.run },
    baseline: { broken: broken.baseline, protected: protectedRun.baseline },
  };
}

async function handleInvoke(decoded: unknown, env: Env): Promise<RefundTargetInvokeClaim> {
  const input = parseInvokeRequest(decoded);
  const { stub, binding } = await stubForRun(input.run, env);
  const result = await stub.invoke({ run: binding, effect: input.input, now: Date.now() });
  const value = unwrapRpc(result);
  return {
    runId: input.run.runId,
    requestId: input.input.requestId,
    claim: value.claim,
  };
}

async function handleObserve(decoded: unknown, env: Env): Promise<RefundTargetObservation> {
  const input = parseObserveRequest(decoded);
  const { stub, binding } = await stubForRun(input.run, env);
  const snapshot = unwrapRpc(await stub.observe({ run: binding, now: Date.now() }));
  return toObservation(input.run, snapshot);
}

async function handleCleanup(decoded: unknown, env: Env): Promise<void> {
  const input = parseCleanupRequest(decoded);
  const targets = await Promise.all([
    stubForRun(input.runs.broken, env),
    stubForRun(input.runs.protected, env),
  ]);
  const results = await Promise.all(
    targets.map(({ stub, binding }) => stub.cleanup(binding)),
  );
  for (const result of results) unwrapRpc(result);
}

async function createRun(
  lane: RefundLane,
  input: Readonly<{ trialRef: RefundTrialRef; requestId: string }>,
  leaseExpiresAt: string,
  expiresAt: number,
  now: number,
  attestation: RefundTargetAttestation,
  env: Env,
): Promise<Readonly<{ run: RefundTargetRun; baseline: RefundTargetObservation }>> {
  const capability = createCapability();
  const capabilityHash = await sha256Hex(capability);
  const run: RefundTargetRun = {
    runId: capability,
    lane,
    requestId: input.requestId,
    trialDigest: input.trialRef.digest,
    leaseExpiresAt,
    attestationDigest: attestation.attestationDigest,
  };
  const binding = toRunBinding(run, capabilityHash);
  const stub = env.REFUND_RUNS.getByName(`refund-run:${capabilityHash}`);
  const initialized = unwrapRpc(await stub.initialize({ ...binding, expiresAt }, now));
  return { run, baseline: toObservation(run, initialized) };
}

async function stubForRun(
  run: RefundTargetRun,
  env: Env,
): Promise<Readonly<{ stub: DurableObjectStub<RefundRunState>; binding: RunBinding }>> {
  const capabilityHash = await sha256Hex(run.runId);
  return {
    stub: env.REFUND_RUNS.getByName(`refund-run:${capabilityHash}`),
    binding: toRunBinding(run, capabilityHash),
  };
}

function toRunBinding(run: RefundTargetRun, capabilityHash: string): RunBinding {
  return {
    capabilityHash,
    lane: run.lane,
    requestId: run.requestId,
    trialDigest: run.trialDigest,
    leaseExpiresAt: run.leaseExpiresAt,
    attestationDigest: run.attestationDigest,
  };
}

function toObservation(run: RefundTargetRun, snapshot: Snapshot): RefundTargetObservation {
  return {
    runId: run.runId,
    lane: snapshot.lane,
    sequence: snapshot.sequence,
    effectCount: snapshot.effectIds.length,
    effectIds: snapshot.effectIds,
    evidenceDigest: snapshot.evidenceDigest,
    observedAt: snapshot.observedAt,
    source: "external-refund-staging",
  };
}

async function createAttestation(deploymentId: string): Promise<RefundTargetAttestation> {
  if (!IDENTIFIER_PATTERN.test(deploymentId)) {
    throw new HttpError(500, "INVALID_CONFIGURATION", "DEPLOYMENT_ID is invalid.");
  }
  const identity = {
    service: SERVICE,
    environment: "staging" as const,
    deploymentId,
    capability: "refund-retry-effect-v1" as const,
    store: "durable" as const,
  };
  return {
    ...identity,
    attestationDigest: await sha256Digest(JSON.stringify(identity)),
  };
}

function parseResetRequest(decoded: unknown): Readonly<{
  trialRef: RefundTrialRef;
  requestId: string;
}> {
  const value = strictRecord(decoded, ["trialRef", "requestId"]);
  const trial = strictRecord(value.trialRef, ["trialId", "epoch", "digest"]);
  const trialRef: RefundTrialRef = {
    trialId: identifier(trial.trialId, "trialRef.trialId"),
    epoch: positiveInteger(trial.epoch, "trialRef.epoch"),
    digest: boundedString(trial.digest, "trialRef.digest", 1, 240),
  };
  return {
    trialRef,
    requestId: identifier(value.requestId, "requestId"),
  };
}

function parseInvokeRequest(decoded: unknown): Readonly<{
  run: RefundTargetRun;
  input: IssueRefundInput;
}> {
  const value = strictRecord(decoded, ["run", "input"]);
  return { run: parseRun(value.run), input: parseIssueRefundInput(value.input) };
}

function parseObserveRequest(decoded: unknown): Readonly<{ run: RefundTargetRun }> {
  const value = strictRecord(decoded, ["run"]);
  return { run: parseRun(value.run) };
}

function parseCleanupRequest(decoded: unknown): Readonly<{
  runs: Readonly<Record<RefundLane, RefundTargetRun>>;
}> {
  const value = strictRecord(decoded, ["runs"]);
  const runs = strictRecord(value.runs, ["broken", "protected"]);
  const broken = parseRun(runs.broken);
  const protectedRun = parseRun(runs.protected);
  if (broken.lane !== "broken" || protectedRun.lane !== "protected") {
    throw invalidRequest("Cleanup run lanes do not match their record keys.");
  }
  return { runs: { broken, protected: protectedRun } };
}

function parseRun(decoded: unknown): RefundTargetRun {
  const value = strictRecord(decoded, [
    "runId",
    "lane",
    "requestId",
    "trialDigest",
    "leaseExpiresAt",
    "attestationDigest",
  ]);
  const runId = boundedString(value.runId, "run.runId", 43, 43);
  if (!CAPABILITY_PATTERN.test(runId)) {
    throw invalidRequest("run.runId is not an opaque staging capability.");
  }
  return {
    runId,
    lane: lane(value.lane, "run.lane"),
    requestId: identifier(value.requestId, "run.requestId"),
    trialDigest: boundedString(value.trialDigest, "run.trialDigest", 1, 240),
    leaseExpiresAt: isoTimestamp(value.leaseExpiresAt, "run.leaseExpiresAt"),
    attestationDigest: boundedString(
      value.attestationDigest,
      "run.attestationDigest",
      16,
      160,
    ),
  };
}

function parseIssueRefundInput(decoded: unknown): IssueRefundInput {
  const value = strictRecord(decoded, [
    "lane",
    "paymentId",
    "amountMinor",
    "currency",
    "requestId",
  ]);
  const currency = boundedString(value.currency, "input.currency", 3, 3);
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw invalidRequest("input.currency must be a three-letter uppercase code.");
  }
  return {
    lane: lane(value.lane, "input.lane"),
    paymentId: identifier(value.paymentId, "input.paymentId"),
    amountMinor: positiveInteger(value.amountMinor, "input.amountMinor"),
    currency,
    requestId: identifier(value.requestId, "input.requestId"),
  };
}

function strictRecord(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidRequest("The JSON body does not match the endpoint contract.");
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  if (
    actualKeys.length !== allowedKeys.length ||
    actualKeys.some((key) => !allowedKeys.includes(key))
  ) {
    throw invalidRequest("The JSON body contains missing or unexpected fields.");
  }
  return record;
}

function identifier(value: unknown, field: string): string {
  const parsed = boundedString(value, field, 1, 160);
  if (!IDENTIFIER_PATTERN.test(parsed)) {
    throw invalidRequest(`${field} contains unsupported characters.`);
  }
  return parsed;
}

function boundedString(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    throw invalidRequest(`${field} must be between ${minimum} and ${maximum} characters.`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw invalidRequest(`${field} must be a positive safe integer.`);
  }
  return value;
}

function lane(value: unknown, field: string): RefundLane {
  if (value !== "broken" && value !== "protected") {
    throw invalidRequest(`${field} must be broken or protected.`);
  }
  return value;
}

function isoTimestamp(value: unknown, field: string): string {
  const parsed = boundedString(value, field, 20, 40);
  const timestamp = Date.parse(parsed);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== parsed) {
    throw invalidRequest(`${field} must be an ISO-8601 timestamp.`);
  }
  return parsed;
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new HttpError(413, "BODY_TOO_LARGE", "The request body exceeds 16 KiB.");
  }
  if (!request.body) throw invalidRequest("A JSON body is required.");

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new HttpError(413, "BODY_TOO_LARGE", "The request body exceeds 16 KiB.");
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalidRequest("The request body is not valid JSON.");
  }
}

function parseTtl(value: string): number {
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_TTL_SECONDS ||
    parsed > MAX_TTL_SECONDS
  ) {
    throw new HttpError(
      500,
      "INVALID_CONFIGURATION",
      `CAPABILITY_TTL_SECONDS must be ${MIN_TTL_SECONDS}-${MAX_TTL_SECONDS}.`,
    );
  }
  return parsed;
}

function createCapability(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Digest(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return `sha256-${bytesToBase64Url(digest)}`;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function timingSafeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) {
    return !crypto.subtle.timingSafeEqual(leftBytes, leftBytes);
  }
  return crypto.subtle.timingSafeEqual(leftBytes, rightBytes);
}

function resolveAllowedOrigin(origin: string | null, configured: string): string | null {
  if (!origin) return null;
  const allowed = configured.split(",").map((candidate) => candidate.trim());
  for (const candidate of allowed) {
    if (!candidate || candidate === "*" || candidate === "null") {
      throw new HttpError(500, "INVALID_CONFIGURATION", "ALLOWED_ORIGINS is invalid.");
    }
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new HttpError(500, "INVALID_CONFIGURATION", "ALLOWED_ORIGINS is invalid.");
    }
    if (
      parsed.origin !== candidate ||
      (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    ) {
      throw new HttpError(500, "INVALID_CONFIGURATION", "ALLOWED_ORIGINS is invalid.");
    }
  }
  return allowed.includes(origin) ? origin : null;
}

function handlePreflight(request: Request, origin: string): Response {
  const requestedMethod = request.headers.get("Access-Control-Request-Method");
  const requestedHeaders = (request.headers.get("Access-Control-Request-Headers") ?? "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (
    requestedMethod !== "POST" ||
    requestedHeaders.some((header) => header !== "content-type")
  ) {
    return jsonError(403, "PREFLIGHT_REJECTED", "The requested CORS operation is not allowed.", origin);
  }
  return emptyResponse(204, origin);
}

function isJsonContentType(contentType: string | null): boolean {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function jsonResponse(
  value: unknown,
  status: number,
  origin: string | null,
  extraHeaders: HeadersInit = {},
): Response {
  const headers = responseHeaders(origin, extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { status, headers });
}

function jsonError(
  status: number,
  code: string,
  message: string,
  origin: string | null = null,
  extraHeaders: HeadersInit = {},
): Response {
  return jsonResponse({ error: { code, message } }, status, origin, extraHeaders);
}

function emptyResponse(status: number, origin: string): Response {
  return new Response(null, { status, headers: responseHeaders(origin) });
}

function responseHeaders(origin: string | null, extraHeaders: HeadersInit = {}): Headers {
  const headers = new Headers(extraHeaders);
  headers.set("Cache-Control", "no-store");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "600");
    headers.append("Vary", "Origin");
  }
  return headers;
}

function success<T>(value: T): RpcResult<T> {
  return { ok: true, value };
}

function failure(code: RpcErrorCode, message: string): RpcResult<never> {
  return { ok: false, error: { code, message } };
}

function unwrapRpc<T>(result: RpcResult<T>): T {
  if (result.ok) return result.value;
  const statusByCode: Readonly<Record<RpcErrorCode, number>> = {
    CAPABILITY_EXPIRED: 410,
    CALL_LIMIT_REACHED: 409,
    INPUT_MISMATCH: 409,
    RUN_ALREADY_INITIALIZED: 409,
    RUN_MISMATCH: 409,
    RUN_NOT_FOUND: 404,
  };
  throw new HttpError(statusByCode[result.error.code], result.error.code, result.error.message);
}

function invalidRequest(message: string): HttpError {
  return new HttpError(400, "INVALID_REQUEST", message);
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
