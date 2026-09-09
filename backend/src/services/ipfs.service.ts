import * as crypto from "crypto";
import { config } from "../config";
import { query } from "../db/client";

// P3.1: rewritten against Kubo's RPC API (a private, self-hosted IPFS node)
// instead of Pinata's REST API.
//
// Kubo's `/api/v0/add` expects a POST'd multipart form under any field name
// and returns one JSON object per added file (newline-delimited if multiple).
// Unlike Pinata, there is no bearer token — access control for a private
// node is the network boundary itself (only institution infrastructure can
// reach this URL), not an app-level credential.
function ipfsAddUrl(): string {
  return `${config.ipfsApiUrl}/api/v0/add`;
}

async function addToIpfs(blob: Blob, fileName: string): Promise<string> {
  const form = new FormData();
  form.append("file", blob, fileName);

  const res = await fetch(ipfsAddUrl(), { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`Kubo add failed: ${res.status} ${await res.text()}`);
  }
  const text = await res.text();
  // Kubo returns one JSON object per line even for a single file.
  const lastLine = text.trim().split("\n").pop()!;
  const parsed = JSON.parse(lastLine) as { Hash: string };
  return parsed.Hash;
}

/**
 * ============================================================================
 * CRY-3 — SALTED CONTENT COMMITMENTS
 * ============================================================================
 *
 * What is anchored on the ledger is `sha256(salt || bytes)`, never a bare hash
 * of the content.
 *
 * A bare hash cannot be inverted, but it does not need to be: anyone holding a
 * candidate document can hash it and confirm it is the anchored one. For
 * structured content — a marksheet is a name, a board, a year and a roll
 * number — the candidate space is small enough to search exhaustively, so a
 * bare hash offers no confidentiality at all.
 *
 * The salt is 32 random bytes kept only in Postgres, and it is what makes DPDP
 * erasure real: destroy the salt and the ledger's commitment can no longer be
 * checked against any candidate, ever. Before this, "erasure" deleted the
 * record while leaving a permanent oracle that could confirm it.
 *
 * The algorithm is recorded per row so the scheme can be rotated later without
 * guessing how any given historical commitment was produced.
 */
const COMMITMENT_ALGORITHM = "sha256-salted-v1";
const SALT_BYTES = 32;

function computeCommitment(salt: Buffer, bytes: Buffer): string {
  return "0x" + crypto.createHash("sha256").update(salt).update(bytes).digest("hex");
}

/** Generates a salt, records it against the CID, and returns the commitment. */
async function commit(cid: string, bytes: Buffer): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES);
  // ON CONFLICT: identical content yields an identical CID, so re-uploading the
  // same bytes must keep the ORIGINAL salt rather than orphan the commitment
  // already anchored on the ledger under it.
  const rows = await query<{ salt: Buffer }>(
    `INSERT INTO content_commitments (cid, salt, algorithm) VALUES ($1, $2, $3)
     ON CONFLICT (cid) DO UPDATE SET cid = EXCLUDED.cid
     RETURNING salt`,
    [cid, salt, COMMITMENT_ALGORITHM]
  );
  return computeCommitment(rows[0].salt, bytes);
}

export type CommitmentCheck =
  /** Salt found and the candidate reproduces the commitment. */
  | { result: "match" }
  /** Salt found and the candidate does NOT reproduce it. */
  | { result: "mismatch" }
  /**
   * No salt on record. Either the content was anchored before CRY-3 (an
   * unsalted keccak256 hash, unverifiable under this scheme), or the salt was
   * destroyed by an erasure — which is the intended, irreversible outcome.
   * Reported distinctly rather than collapsed into "mismatch", because
   * "cannot be checked" and "is not the document" are different answers.
   */
  | { result: "unverifiable" };

export async function verifyContentCommitment(
  cid: string,
  candidate: Buffer,
  anchoredCommitment: string
): Promise<CommitmentCheck> {
  const rows = await query<{ salt: Buffer }>(`SELECT salt FROM content_commitments WHERE cid = $1`, [cid]);
  if (rows.length === 0) return { result: "unverifiable" };

  const expected = computeCommitment(rows[0].salt, candidate);
  // Constant-time compare — this is a verification oracle, and a timing side
  // channel here would leak how much of a guess was correct.
  const a = Buffer.from(expected);
  const b = Buffer.from(anchoredCommitment);
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { result: match ? "match" : "mismatch" };
}

/**
 * Destroys the salt for a CID, permanently ending any ability to verify the
 * ledger's commitment against a candidate document.
 *
 * NOT yet wired into the DPDP erasure flow. `/vault/erase` erases by DID hash,
 * and the mapping from a citizen to the CIDs of their assets lives on the
 * ledger rather than in Postgres, so there is no query that turns "erase this
 * citizen" into "these CIDs" today. Building that mapping is the remaining work
 * to make asset-level erasure complete; this primitive is what it will call.
 */
export async function forgetContentCommitment(cid: string): Promise<{ forgotten: boolean }> {
  const rows = await query(`DELETE FROM content_commitments WHERE cid = $1 RETURNING cid`, [cid]);
  return { forgotten: rows.length > 0 };
}

/// Uploads asset metadata (never raw PII — see vault.service.ts) to the
/// private IPFS node and returns the CID plus a salted commitment suitable for
/// anchoring on the ledger.
///
/// TM-05: `encrypted` is a REQUIRED, no-default parameter rather than a
/// comment-only convention. Every call site must consciously state whether the
/// bytes it is handing to a permanent content store are pre-encrypted or known
/// not to contain PII — a careless future call site can no longer silently
/// upload plaintext PII by omitting a step nothing enforced.
export async function uploadJsonToIpfs(
  data: Record<string, unknown>,
  encrypted: boolean
): Promise<{ cid: string; contentHash: string }> {
  if (typeof encrypted !== "boolean") {
    throw new Error("uploadJsonToIpfs: caller must explicitly state whether this payload is encrypted or PII-free.");
  }
  const json = Buffer.from(JSON.stringify(data), "utf8");
  const cid = await addToIpfs(new Blob([json], { type: "application/json" }), "data.json");
  return { cid, contentHash: await commit(cid, json) };
}

/// Uploads a raw file (e.g. an asset document) to the private IPFS node.
///
/// TM-05: see uploadJsonToIpfs's note above — `encrypted` must be true (the
/// buffer is already ciphertext) or the caller must have separately asserted
/// the content contains no PII. This function still does not (and cannot)
/// inspect content itself, so the boundary is enforced at the API layer that
/// calls it (see routes/fabric/assets.routes.ts), which requires an explicit
/// `encrypted` field on every upload request rather than defaulting one.
export async function uploadFileToIpfs(
  fileBuffer: Buffer,
  fileName: string,
  encrypted: boolean
): Promise<{ cid: string; contentHash: string }> {
  if (typeof encrypted !== "boolean") {
    throw new Error("uploadFileToIpfs: caller must explicitly state whether this file is encrypted or PII-free.");
  }
  const cid = await addToIpfs(new Blob([Uint8Array.from(fileBuffer)]), fileName);
  return { cid, contentHash: await commit(cid, fileBuffer) };
}
