/**
 * TrustMesh world-state data model.
 *
 * SCOPE RULE (migration proposal scope note, IMPLEMENTATION_PROMPT.md scope
 * boundary): PS 26125 asks for generic identity, RBAC and NFT-represented
 * digital assets. Nothing in this file — or anywhere in this chaincode — may
 * become specific to any one asset domain. An asset carries an owner, a
 * storage pointer and a content hash; what the document behind it *is* is
 * never the ledger's business.
 *
 * PRIVACY RULE (Final Solution §6): the ledger records PROOFS, never PERSONAL
 * DATA. Every field below is a hash, a public key, an opaque identifier or a
 * timestamp. No name, address, document body or human-readable org label is
 * storable through any chaincode function.
 */

/** docType discriminators — also what the CouchDB rich-query selectors match on. */
export const DOC_TYPE = {
  DID: 'did',
  ROLE: 'role',
  STATUS: 'status',
  ASSET: 'asset',
  PROPOSAL: 'proposal',
} as const;

/**
 * An identity anchor. Mirrors DIDRegistry.sol's DIDRecord.
 *
 * `did` is a did:key identifier (§5 decision 1). `controllerPublicKey` is the
 * SPKI DER of the ECDSA P-256 public key that currently controls it, base64.
 * The two are separate fields on purpose: the DID is stable for life, while
 * the controlling key can be rotated (normal key rotation) or re-bound after a
 * guardian recovery vote — exactly the EVM contract's updateController path.
 */
export interface DIDRecord {
  docType: typeof DOC_TYPE.DID;
  didHash: string;
  did: string;
  controllerPublicKey: string;
  registeredAt: string;
  updatedAt: string;
}

/**
 * An RBAC grant. Mirrors AccessControlRegistry.sol's roleExpiry mapping.
 *
 * `roleId` is a hash (the backend sends sha256("TRUSTMESH_ADMIN_ROLE") etc.),
 * never the string "Admin" and never "Manager of Department X" — the
 * human-readable role/org mapping lives off-chain in the Postgres vault where
 * it can be corrected or erased under DPDP.
 *
 * `subject` is the identity the role is granted to, as a DID hash.
 */
export interface RoleRecord {
  docType: typeof DOC_TYPE.ROLE;
  roleId: string;
  subject: string;
  grantedAt: string;
  expiry: string;
  granted: boolean;
}

/**
 * Shared status entry for Verifiable Credentials and RBAC grants alike.
 * Mirrors RevocationRegistry.sol. Deliberately nothing but an opaque status id.
 */
export interface StatusRecord {
  docType: typeof DOC_TYPE.STATUS;
  statusId: string;
  revoked: boolean;
  expiry: string;
  updatedAt: string;
}

/**
 * A digital asset. Mirrors AssetNFT.sol's AssetMeta plus ownership.
 *
 * `ipfsCID` points at the private, self-hosted Kubo store; `contentHash` proves
 * integrity of whatever is behind it. The asset's actual content — encrypted
 * before it ever reaches storage — never touches the ledger.
 */
export interface AssetRecord {
  docType: typeof DOC_TYPE.ASSET;
  assetId: string;
  owner: string;
  ipfsCID: string;
  contentHash: string;
  mintedAt: string;
  updatedAt: string;
}

/** The governed actions. Anything that mutates privileged state is one of these. */
export type ActionType =
  | 'GRANT_ROLE'
  | 'REVOKE_ROLE'
  | 'MINT_ASSET'
  | 'TRANSFER_ASSET'
  | 'UPDATE_CONTROLLER'
  | 'SET_CREDENTIAL_STATUS';

export const ACTION_TYPES: ActionType[] = [
  'GRANT_ROLE',
  'REVOKE_ROLE',
  'MINT_ASSET',
  'TRANSFER_ASSET',
  'UPDATE_CONTROLLER',
  'SET_CREDENTIAL_STATUS',
];

/**
 * Who approved, identified both by organization and by the named human whose
 * certificate signed the approval.
 *
 * Recording the CN as well as the MSP ID is what keeps the Final Solution's
 * governance claim honest: approvals are "individually attributable", not just
 * "some peer in Org2 endorsed this" (migration proposal §3).
 */
export interface Approval {
  mspId: string;
  signer: string;
  approvedAt: string;
}

export type ProposalStatus = 'PENDING' | 'EXECUTED' | 'CANCELLED';

/**
 * The application-level multi-sig record — the direct replacement for a Gnosis
 * Safe transaction (migration proposal §3, application layer).
 *
 * `approvals` must contain entries from at least `threshold` DISTINCT
 * organizations before Execute will dispatch. That is the "2-of-3 named
 * signers, no single admin key" property, preserved functionally unchanged
 * from the EVM design.
 */
export interface ProposalRecord {
  docType: typeof DOC_TYPE.PROPOSAL;
  proposalId: string;
  actionType: ActionType;
  params: Record<string, string>;
  proposedBy: string;
  proposedByMsp: string;
  proposedAt: string;
  threshold: number;
  approvals: Approval[];
  status: ProposalStatus;
  executedAt: string;
  result: string;
}
