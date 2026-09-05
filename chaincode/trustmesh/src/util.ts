import { Context } from 'fabric-contract-api';
import * as crypto from 'crypto';

/**
 * DETERMINISM — read before adding any code to this chaincode.
 *
 * Every endorsing peer executes the same transaction independently, and their
 * read/write sets must match byte-for-byte or the transaction is rejected at
 * commit time. Under a single-org endorsement policy a non-deterministic
 * chaincode still appears to work perfectly, and only starts failing once a
 * multi-org policy is applied — which is precisely the trap the migration
 * proposal's §9 warns about ("easy to build a policy that looks enforced but
 * isn't", and the general "test immediately, not in a batch at the end").
 *
 * The rules, enforced by using the helpers below instead of the obvious thing:
 *   - NEVER Date.now() / new Date()      -> use txTimestamp(ctx)
 *   - NEVER Math.random() / crypto UUIDs -> use ctx.stub.getTxID()
 *   - NEVER iterate an object's keys in insertion order when the object came
 *     from JSON.parse of caller input -> sort explicitly (see stableStringify)
 */

/**
 * The transaction's timestamp, taken from the proposal itself so that every
 * endorsing peer computes the identical value. This is the ONLY clock this
 * chaincode is allowed to read.
 */
export function txTimestamp(ctx: Context): string {
  const ts = ctx.stub.getTxTimestamp();
  // seconds arrives as a Long-like object from protobuf, or a plain number.
  const seconds =
    typeof ts.seconds === 'number' ? ts.seconds : Number((ts.seconds as unknown as { toString(): string }).toString());
  const millis = seconds * 1000 + Math.floor((ts.nanos ?? 0) / 1e6);
  return new Date(millis).toISOString();
}

/** Epoch milliseconds for the current transaction — for expiry comparisons. */
export function txEpochMillis(ctx: Context): number {
  return Date.parse(txTimestamp(ctx));
}

/**
 * JSON with object keys sorted, so two peers serializing the same logical
 * record always produce identical bytes regardless of key insertion order.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (v as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return v;
  });
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * The status id shared by the RBAC and revocation registries.
 * Mirrors AccessControlRegistry.sol's `keccak256(abi.encodePacked(role, account))`.
 */
export function statusIdFor(roleId: string, subject: string): string {
  return sha256Hex(`${roleId}:${subject}`);
}

// --- World-state keys ---------------------------------------------------------
// Composite keys keep the four logical registries in separate keyspaces within
// one chaincode, the way four separate contract addresses did on EVM.

export const KEY_PREFIX = {
  DID: 'did',
  ROLE: 'role',
  STATUS: 'status',
  ASSET: 'asset',
  PROPOSAL: 'proposal',
} as const;

export const ASSET_COUNTER_KEY = 'trustmesh.assetCounter';

export function didKey(ctx: Context, didHash: string): string {
  return ctx.stub.createCompositeKey(KEY_PREFIX.DID, [didHash]);
}
export function roleKey(ctx: Context, roleId: string, subject: string): string {
  return ctx.stub.createCompositeKey(KEY_PREFIX.ROLE, [roleId, subject]);
}
export function statusKey(ctx: Context, statusId: string): string {
  return ctx.stub.createCompositeKey(KEY_PREFIX.STATUS, [statusId]);
}
export function assetKey(ctx: Context, assetId: string): string {
  return ctx.stub.createCompositeKey(KEY_PREFIX.ASSET, [assetId]);
}
export function proposalKey(ctx: Context, proposalId: string): string {
  return ctx.stub.createCompositeKey(KEY_PREFIX.PROPOSAL, [proposalId]);
}

// --- State access -------------------------------------------------------------

export async function getState<T>(ctx: Context, key: string): Promise<T | null> {
  const bytes = await ctx.stub.getState(key);
  if (!bytes || bytes.length === 0) return null;
  return JSON.parse(bytes.toString()) as T;
}

export async function putState(ctx: Context, key: string, value: unknown): Promise<void> {
  await ctx.stub.putState(key, Buffer.from(stableStringify(value)));
}

// --- Caller identity ----------------------------------------------------------

/**
 * The submitting organization's MSP ID — one of Org1MSP / Org2MSP / Org3MSP,
 * which map to IssuingDept / AuditOrg / IndependentVerifier respectively.
 * This is what the 2-of-3 governance threshold counts distinct values of.
 */
export function callerMsp(ctx: Context): string {
  return ctx.clientIdentity.getMSPID();
}

/**
 * The named human (certificate CN) behind the submitting identity.
 *
 * §3's whole point is that approvals stay individually attributable, not just
 * "some peer in Org2 endorsed this" — so the audit trail records who, not only
 * which org. Falls back to the raw identity string if no CN is present.
 */
export function callerSigner(ctx: Context): string {
  const id = ctx.clientIdentity.getID();
  const match = /CN=([^,:/]+)/.exec(id);
  return match ? match[1] : id;
}

// --- Proof of possession ------------------------------------------------------

/**
 * Verifies that whoever asked for this DID actually holds the private key for
 * the public key being recorded as its controller.
 *
 * WHY THIS EXISTS. On EVM, DIDRegistry.registerDID() bound `msg.sender` as the
 * controller, so identity creation was self-sovereign by construction — the
 * Final Solution (§3 Step 1) calls that out as deliberate. Under §4's decided
 * design the backend submits the transaction on the citizen's behalf, which
 * would otherwise let a compromised backend register a DID against a key it
 * controls. Requiring a signature over the DID string, verified here in
 * chaincode, restores the original property: the ledger will not record a
 * controller key that the requester cannot prove possession of.
 *
 * Format is what WebCrypto produces natively (the §4 identity choice):
 * ECDSA P-256, SPKI DER public key, and a raw r||s signature — hence
 * dsaEncoding 'ieee-p1363' rather than Node's DER default.
 */
export function verifyPossession(publicKeyB64: string, message: string, signatureB64: string): boolean {
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(publicKeyB64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(
      'sha256',
      Buffer.from(message, 'utf8'),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signatureB64, 'base64')
    );
  } catch {
    return false;
  }
}

/** Rejects empty/whitespace-only caller input early, with a clear message. */
export function requireArg(name: string, value: string | undefined): string {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`${name} is required`);
  }
  return String(value);
}
