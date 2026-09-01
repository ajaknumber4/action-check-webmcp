const FORBIDDEN_FIELD = /^(?:accessToken|refreshToken|authorizationCode|codeVerifier|cookie|jwt|nonce|stateValue|clientSecret)$/i;
const FORBIDDEN_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~-]+|[?&](?:code|state|access_token|refresh_token|client_secret)=|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.)/i;

export function assertSafeOutput(value: unknown, path = "output"): void {
  if (typeof value === "string") {
    if (FORBIDDEN_VALUE.test(value)) {
      throw new Error(`Unsafe value at ${path}`);
    }
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((child, index) => assertSafeOutput(child, `${path}[${index}]`));
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_FIELD.test(key)) {
      throw new Error(`Unsafe field at ${path}`);
    }
    assertSafeOutput(child, `${path}.${key}`);
  }
}
