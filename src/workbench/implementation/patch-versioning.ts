import type { PatchField, PatchRef } from "../interface";

export type PatchIdentityInput = Readonly<{
  caseId: string;
  sessionEpoch: number;
  patchId: string;
  version: number;
  field: PatchField;
  before: string;
  after: string;
}>;

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createPatchRef(input: PatchIdentityInput): PatchRef {
  const digestSource = [
    input.caseId,
    input.sessionEpoch,
    input.patchId,
    input.version,
    input.field,
    input.before,
    input.after,
  ].join("|");

  return Object.freeze({
    caseId: input.caseId,
    sessionEpoch: input.sessionEpoch,
    patchId: input.patchId,
    version: input.version,
    digest: `fnv1a-${fnv1a(digestSource)}`,
  });
}

export function patchRefsEqual(left: PatchRef, right: PatchRef): boolean {
  return (
    left.caseId === right.caseId &&
    left.sessionEpoch === right.sessionEpoch &&
    left.patchId === right.patchId &&
    left.version === right.version &&
    left.digest === right.digest
  );
}
