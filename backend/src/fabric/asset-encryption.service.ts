import * as crypto from 'crypto';
import { config } from '../config';

/**
 * V2 FIX — asset document encryption before IPFS upload.
 *
 * Audit finding (§9/§V2): POST /assets/mint carried only a comment saying a
 * document "should" be encrypted before uploadFileToIpfs — no encryption
 * ever actually happened. Live exploit: a PII-marked file minted through the
 * real endpoint came back in plaintext directly from Kubo, bypassing the
 * backend entirely (content-addressed storage has no access control of its
 * own — the network boundary was the only thing standing between a reader
 * and the raw bytes).
 *
 * This module mirrors services/vault.service.ts's envelope-encryption
 * pattern (random per-record DEK, AES-256-GCM, DEK wrapped by
 * PII_VAULT_MASTER_KEY) WITHOUT modifying vault.service.ts itself, per the
 * standing ground rule to touch it not at all. It is deliberately a
 * standalone module rather than an import from vault.service.ts, since that
 * file's functions are keyed by (didHash, fieldName) — a PII-vault-specific
 * shape — where this one operates on an arbitrary file buffer keyed later by
 * IPFS CID (see routes/fabric/assets.routes.ts and schema.sql's
 * asset_encryption_keys table for why CID, not assetId).
 *
 * The one deliberate addition beyond vault.service.ts's own pattern: an AAD
 * (additional authenticated data) tag binds every asset ciphertext to a
 * fixed context string, so a ciphertext produced by this module can never be
 * silently reinterpreted as coming from a different encryption context
 * (e.g. the PII vault) even if key material were ever shared or confused.
 */

const ASSET_DOCUMENT_AAD = Buffer.from('trustmesh:asset-document:v1', 'utf8');

function getMasterKey(): Buffer {
  if (!config.piiVaultMasterKey) {
    throw new Error('PII_VAULT_MASTER_KEY not set — see backend/.env.example.');
  }
  const key = Buffer.from(config.piiVaultMasterKey, 'hex');
  if (key.length !== 32) {
    throw new Error('PII_VAULT_MASTER_KEY must be 32 bytes (64 hex chars). Generate with: openssl rand -hex 32');
  }
  return key;
}

export interface EncryptedAsset {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  /** The per-file DEK, wrapped (AES-256-GCM) with PII_VAULT_MASTER_KEY, as wrapIv|wrapAuthTag|wrapCiphertext. */
  wrappedDek: Buffer;
}

/** Encrypts a file buffer with a fresh random DEK before it ever reaches IPFS. */
export function encryptAssetBuffer(plaintext: Buffer): EncryptedAsset {
  const masterKey = getMasterKey();
  const dek = crypto.randomBytes(32);

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
  cipher.setAAD(ASSET_DOCUMENT_AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const wrapIv = crypto.randomBytes(12);
  const wrapCipher = crypto.createCipheriv('aes-256-gcm', masterKey, wrapIv);
  const wrapCiphertext = Buffer.concat([wrapCipher.update(dek), wrapCipher.final()]);
  const wrapAuthTag = wrapCipher.getAuthTag();
  const wrappedDek = Buffer.concat([wrapIv, wrapAuthTag, wrapCiphertext]);

  return { ciphertext, iv, authTag, wrappedDek };
}

/** Reverses encryptAssetBuffer, given the stored wrapped DEK/IV/auth tag for this file. */
export function decryptAssetBuffer(ciphertext: Buffer, iv: Buffer, authTag: Buffer, wrappedDek: Buffer): Buffer {
  const masterKey = getMasterKey();

  const wrapIv = wrappedDek.subarray(0, 12);
  const wrapAuthTag = wrappedDek.subarray(12, 28);
  const wrapCiphertext = wrappedDek.subarray(28);
  const unwrapCipher = crypto.createDecipheriv('aes-256-gcm', masterKey, wrapIv);
  unwrapCipher.setAuthTag(wrapAuthTag);
  const dek = Buffer.concat([unwrapCipher.update(wrapCiphertext), unwrapCipher.final()]);

  const decipher = crypto.createDecipheriv('aes-256-gcm', dek, iv);
  decipher.setAAD(ASSET_DOCUMENT_AAD);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
