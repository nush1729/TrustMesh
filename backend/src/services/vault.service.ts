import * as crypto from "crypto";
import { query, pool } from "../db/client";
import { config } from "../config";

/// Field-level envelope encryption for PII. Every field gets its own random
/// data-encryption-key (DEK); the DEK itself is wrapped (encrypted) with the
/// PII_VAULT_MASTER_KEY. DPDP "erasure" = deleting the row, which makes the
/// ciphertext permanently unrecoverable — including for any on-chain/IPFS
/// hash pointer that referenced it. The chain/IPFS content itself is never
/// touched or rewritten; it just becomes cryptographically meaningless.

function getMasterKey(): Buffer {
  if (!config.piiVaultMasterKey) {
    throw new Error("PII_VAULT_MASTER_KEY not set — see backend/.env.example.");
  }
  const key = Buffer.from(config.piiVaultMasterKey, "hex");
  if (key.length !== 32) {
    throw new Error("PII_VAULT_MASTER_KEY must be 32 bytes (64 hex chars). Generate with: openssl rand -hex 32");
  }
  return key;
}

function encrypt(plaintext: string, key: Buffer): { ciphertext: Buffer; iv: Buffer; authTag: Buffer } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

function decrypt(ciphertext: Buffer, iv: Buffer, authTag: Buffer, key: Buffer): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export async function storeField(didHash: string, fieldName: string, value: string, contentHash?: string) {
  const masterKey = getMasterKey();
  const dek = crypto.randomBytes(32);

  const { ciphertext, iv, authTag } = encrypt(value, dek);
  const wrapped = encrypt(dek.toString("hex"), masterKey);
  // Store the wrapped DEK as iv|authTag|ciphertext so it can be unwrapped later.
  const dekWrapped = Buffer.concat([wrapped.iv, wrapped.authTag, wrapped.ciphertext]);

  await query(
    `INSERT INTO pii_vault (did_hash, field_name, ciphertext, iv, auth_tag, dek_wrapped, content_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [didHash, fieldName, ciphertext, iv, authTag, dekWrapped, contentHash ?? null]
  );
}

export async function readField(didHash: string, fieldName: string): Promise<string | null> {
  const masterKey = getMasterKey();
  const rows = await query<{ ciphertext: Buffer; iv: Buffer; auth_tag: Buffer; dek_wrapped: Buffer }>(
    `SELECT ciphertext, iv, auth_tag, dek_wrapped FROM pii_vault
     WHERE did_hash = $1 AND field_name = $2
     ORDER BY created_at DESC LIMIT 1`,
    [didHash, fieldName]
  );
  const row = rows[0];
  if (!row) return null;

  const wrappedIv = row.dek_wrapped.subarray(0, 12);
  const wrappedAuthTag = row.dek_wrapped.subarray(12, 28);
  const wrappedCiphertext = row.dek_wrapped.subarray(28);
  const dekHex = decrypt(wrappedCiphertext, wrappedIv, wrappedAuthTag, masterKey);
  const dek = Buffer.from(dekHex, "hex");

  return decrypt(row.ciphertext, row.iv, row.auth_tag, dek);
}

/// DPDP Right to Erasure: permanently deletes every PII record for a DID.
/// This is real deletion at the database layer (not merely "marking
/// deleted"), which is the whole point — it must be unrecoverable.
export async function eraseAllForUser(didHash: string): Promise<{ erasedRows: number }> {
  const client = await pool.connect();
  try {
    const result = await client.query(`DELETE FROM pii_vault WHERE did_hash = $1`, [didHash]);
    return { erasedRows: result.rowCount ?? 0 };
  } finally {
    client.release();
  }
}
