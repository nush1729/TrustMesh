import { Context } from 'fabric-contract-api';
import {
  AssetRecord,
  DIDRecord,
  DOC_TYPE,
  RoleRecord,
  StatusRecord,
} from './types';
import {
  ASSET_COUNTER_KEY,
  assetKey,
  didKey,
  getState,
  putState,
  roleKey,
  statusIdFor,
  statusKey,
  txEpochMillis,
  txTimestamp,
} from './util';

/**
 * The four logical registries' state transitions, in one place.
 *
 * NOTHING IN THIS FILE IS A @Transaction, AND THAT IS THE POINT.
 *
 * On EVM, "only the Safe can do this" was enforced by an `onlyOwner` modifier:
 * the function was still publicly callable, it just reverted for everyone else.
 * Fabric has no equivalent modifier, and any @Transaction method is invocable
 * by anyone with channel access. So the privileged mutations below are plain
 * TypeScript functions with no decorator — they are not part of the chaincode's
 * external surface at all, and the ONLY caller is
 * GovernanceContract.ExecuteProposal, which runs them after it has verified a
 * 2-of-3 multi-organization approval.
 *
 * That makes "no single admin key can grant a role or mint an asset"
 * structurally true rather than policy-true: there is no code path that reaches
 * these functions without a satisfied threshold.
 *
 * Each function returns the chaincode event to emit. Fabric permits exactly one
 * event per transaction, so the caller — not this layer — decides and sets it.
 */

export interface DomainEvent {
  name: string;
  payload: Record<string, unknown>;
}

// --- DIDRegistry ---------------------------------------------------------------

export async function readDid(ctx: Context, didHash: string): Promise<DIDRecord | null> {
  return getState<DIDRecord>(ctx, didKey(ctx, didHash));
}

/**
 * Mirrors DIDRegistry.registerDID(). Proof of possession is checked by the
 * caller (DIDRegistryContract) before this runs.
 */
export async function registerDid(
  ctx: Context,
  didHash: string,
  did: string,
  controllerPublicKey: string
): Promise<DomainEvent> {
  if (await readDid(ctx, didHash)) {
    throw new Error(`DIDRegistry: already registered`);
  }
  const now = txTimestamp(ctx);
  const record: DIDRecord = {
    docType: DOC_TYPE.DID,
    didHash,
    did,
    controllerPublicKey,
    registeredAt: now,
    updatedAt: now,
  };
  await putState(ctx, didKey(ctx, didHash), record);
  return { name: 'DIDRegistered', payload: { didHash, did, controller: controllerPublicKey, timestamp: now } };
}

/**
 * Mirrors DIDRegistry.updateController() — key rotation, or re-binding after a
 * guardian recovery vote. GOVERNED: reachable only via ExecuteProposal.
 *
 * On EVM this was callable by the current controller OR the recovery module.
 * Here it is callable by neither directly: both paths go through a proposal, so
 * a recovery re-binding is now itself a multi-party approved, individually
 * attributable act rather than a single backend key's decision. That closes the
 * same identity-hijack class the Stage 1 P0.1 fix addressed, structurally.
 */
export async function updateController(
  ctx: Context,
  didHash: string,
  newControllerPublicKey: string
): Promise<DomainEvent> {
  const record = await readDid(ctx, didHash);
  if (!record) throw new Error(`DIDRegistry: unknown DID`);
  const old = record.controllerPublicKey;
  record.controllerPublicKey = newControllerPublicKey;
  record.updatedAt = txTimestamp(ctx);
  await putState(ctx, didKey(ctx, didHash), record);
  return {
    name: 'ControllerUpdated',
    payload: { didHash, oldController: old, newController: newControllerPublicKey, timestamp: record.updatedAt },
  };
}

// --- RevocationRegistry ---------------------------------------------------------

export async function readStatus(ctx: Context, statusId: string): Promise<StatusRecord | null> {
  return getState<StatusRecord>(ctx, statusKey(ctx, statusId));
}

/** Mirrors RevocationRegistry.setStatus() / setExpiry(). GOVERNED. */
export async function setStatus(
  ctx: Context,
  statusId: string,
  revoked: boolean,
  expiry?: string
): Promise<DomainEvent> {
  const now = txTimestamp(ctx);
  const existing = await readStatus(ctx, statusId);
  const record: StatusRecord = {
    docType: DOC_TYPE.STATUS,
    statusId,
    revoked,
    expiry: expiry !== undefined ? expiry : existing?.expiry ?? '0',
    updatedAt: now,
  };
  await putState(ctx, statusKey(ctx, statusId), record);
  return { name: 'StatusChanged', payload: { statusId, revoked, expiry: record.expiry, timestamp: now } };
}

export async function isRevoked(ctx: Context, statusId: string): Promise<boolean> {
  const record = await readStatus(ctx, statusId);
  return record?.revoked ?? false;
}

/** Mirrors RevocationRegistry.isExpired(): expiry 0 means "no expiry set". */
export async function isExpired(ctx: Context, statusId: string): Promise<boolean> {
  const record = await readStatus(ctx, statusId);
  if (!record) return false;
  const exp = Number(record.expiry);
  return exp !== 0 && txEpochMillis(ctx) > exp * 1000;
}

// --- AccessControlRegistry -------------------------------------------------------

export async function readRole(ctx: Context, roleId: string, subject: string): Promise<RoleRecord | null> {
  return getState<RoleRecord>(ctx, roleKey(ctx, roleId, subject));
}

/**
 * Mirrors AccessControlRegistry.grantRoleWithExpiry(). GOVERNED.
 * `expiry` is a unix timestamp in SECONDS, matching the Solidity signature.
 */
export async function grantRoleWithExpiry(
  ctx: Context,
  roleId: string,
  subject: string,
  expiry: string
): Promise<DomainEvent> {
  const expirySeconds = Number(expiry);
  if (!Number.isFinite(expirySeconds) || expirySeconds <= 0) {
    throw new Error('AccessControlRegistry: expiry must be a positive unix timestamp');
  }
  if (expirySeconds * 1000 <= txEpochMillis(ctx)) {
    throw new Error('AccessControlRegistry: expiry must be in the future');
  }
  const now = txTimestamp(ctx);
  const record: RoleRecord = {
    docType: DOC_TYPE.ROLE,
    roleId,
    subject,
    grantedAt: now,
    expiry: String(expirySeconds),
    granted: true,
  };
  await putState(ctx, roleKey(ctx, roleId, subject), record);
  // Keep the shared status registry in step, exactly as the Solidity version did.
  await setStatus(ctx, statusIdFor(roleId, subject), false, String(expirySeconds));
  return {
    name: 'RoleGrantedWithExpiry',
    payload: { roleId, subject, expiry: String(expirySeconds), timestamp: now },
  };
}

/** Mirrors AccessControlRegistry.revokeRoleEarly(). GOVERNED. */
export async function revokeRoleEarly(ctx: Context, roleId: string, subject: string): Promise<DomainEvent> {
  const record = await readRole(ctx, roleId, subject);
  if (!record || !record.granted) {
    throw new Error('AccessControlRegistry: role not granted');
  }
  record.granted = false;
  await putState(ctx, roleKey(ctx, roleId, subject), record);
  await setStatus(ctx, statusIdFor(roleId, subject), true);
  return {
    name: 'RoleRevokedEarly',
    payload: { roleId, subject, timestamp: txTimestamp(ctx) },
  };
}

/**
 * Mirrors AccessControlRegistry.hasActiveRole() — the full RBAC lifecycle
 * check: granted, not expired, and not explicitly revoked. All three, in that
 * order, same as the Solidity original.
 */
export async function hasActiveRole(ctx: Context, roleId: string, subject: string): Promise<boolean> {
  const record = await readRole(ctx, roleId, subject);
  if (!record || !record.granted) return false;
  const exp = Number(record.expiry);
  if (exp !== 0 && txEpochMillis(ctx) > exp * 1000) return false;
  if (await isRevoked(ctx, statusIdFor(roleId, subject))) return false;
  return true;
}

// --- AssetNFT ---------------------------------------------------------------------

export async function readAsset(ctx: Context, assetId: string): Promise<AssetRecord | null> {
  return getState<AssetRecord>(ctx, assetKey(ctx, assetId));
}

/**
 * Mirrors AssetNFT.mintAsset(). GOVERNED.
 *
 * The id comes from a monotonic ledger counter rather than a random value: it
 * has to be identical on every endorsing peer, and it reproduces the ERC-721
 * `_nextTokenId++` behaviour the EVM version had.
 */
export async function mintAsset(
  ctx: Context,
  owner: string,
  ipfsCID: string,
  contentHash: string
): Promise<DomainEvent & { assetId: string }> {
  const counterBytes = await ctx.stub.getState(ASSET_COUNTER_KEY);
  const next = counterBytes && counterBytes.length > 0 ? Number(counterBytes.toString()) : 0;
  const assetId = String(next);
  await ctx.stub.putState(ASSET_COUNTER_KEY, Buffer.from(String(next + 1)));

  const now = txTimestamp(ctx);
  const record: AssetRecord = {
    docType: DOC_TYPE.ASSET,
    assetId,
    owner,
    ipfsCID,
    contentHash,
    mintedAt: now,
    updatedAt: now,
  };
  await putState(ctx, assetKey(ctx, assetId), record);
  return {
    assetId,
    name: 'AssetMinted',
    payload: { assetId, to: owner, ipfsCID, contentHash, timestamp: now },
  };
}

/**
 * Mirrors AssetNFT.transferAsset(). GOVERNED.
 *
 * As on EVM, there is deliberately no open, holder-callable transfer: custody
 * changes in TrustMesh are institutional decisions requiring the same sign-off
 * as the original allocation, not peer-to-peer trades (Final Solution §3 Step 6).
 */
export async function transferAsset(
  ctx: Context,
  assetId: string,
  from: string,
  to: string
): Promise<DomainEvent> {
  const record = await readAsset(ctx, assetId);
  if (!record) throw new Error('AssetNFT: unknown asset');
  if (record.owner !== from) throw new Error('AssetNFT: from is not current owner');
  record.owner = to;
  record.updatedAt = txTimestamp(ctx);
  await putState(ctx, assetKey(ctx, assetId), record);
  return { name: 'AssetTransferred', payload: { assetId, from, to, timestamp: record.updatedAt } };
}
