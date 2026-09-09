import { ethers } from "ethers";
import { config } from "../config";

// P3.1: rewritten against Kubo's RPC API (a private, self-hosted IPFS node)
// instead of Pinata's REST API. Function signatures are unchanged so no
// other file needs to change — see docs/CHANGE_PROPOSAL.md P3.1.
//
// Kubo's `/api/v0/add` expects a POST'd multipart form under any field name
// and returns one JSON object per added file (newline-delimited if multiple).
// Unlike Pinata, there is no bearer token — access control for a private
// node is the network boundary itself (only institution infrastructure can
// reach this URL), not an app-level credential.
function ipfsAddUrl(): string {
  return `${config.ipfsApiUrl}/api/v0/add`;
}

function ipfsCatUrl(cid: string): string {
  return `${config.ipfsApiUrl}/api/v0/cat?arg=${encodeURIComponent(cid)}`;
}

/// V2 fix: reads raw bytes back from the private Kubo node by CID. Added
/// alongside the asset-document encryption fix (routes/fabric/assets.routes.ts,
/// fabric/asset-encryption.service.ts) so GET /assets/:assetId/document can
/// fetch the (encrypted) bytes server-side and decrypt them before ever
/// returning anything to a caller — the same node the audit queried directly
/// with `/api/v0/cat` to prove the plaintext-retrieval exploit.
export async function fetchFromIpfs(cid: string): Promise<Buffer> {
  const res = await fetch(ipfsCatUrl(cid), { method: 'POST' });
  if (!res.ok) {
    throw new Error(`Kubo cat failed: ${res.status} ${await res.text()}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
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

/// Uploads asset metadata (never raw PII — see vault.service.ts) to the
/// private IPFS node and returns the CID plus a keccak256 content hash
/// suitable for anchoring on-chain in AssetNFT.mintAsset.
///
/// TM-05 fix: `encrypted` is a REQUIRED, no-default parameter rather than a
/// comment-only convention. Every call site must now consciously state
/// whether the bytes it is handing to a public, self-hosted-but-permanent
/// content store are pre-encrypted or are known not to contain PII — a
/// careless future call site can no longer silently upload plaintext PII
/// simply by omitting a step nothing enforced. This does not change what gets
/// uploaded or how CIDs/content hashes are computed; it only requires the
/// caller to name its own intent, which the request layer must in turn get
/// from an explicit, auditable field rather than assume.
export async function uploadJsonToIpfs(
  data: Record<string, unknown>,
  encrypted: boolean
): Promise<{ cid: string; contentHash: string }> {
  if (typeof encrypted !== "boolean") {
    throw new Error("uploadJsonToIpfs: caller must explicitly state whether this payload is encrypted or PII-free.");
  }
  const json = JSON.stringify(data);
  const cid = await addToIpfs(new Blob([json], { type: "application/json" }), "data.json");
  const contentHash = ethers.keccak256(ethers.toUtf8Bytes(json));
  return { cid, contentHash };
}

/// Uploads a raw file (e.g. an asset document) to the private IPFS node.
///
/// TM-05 fix: see uploadJsonToIpfs's note above — `encrypted` must be true
/// (the buffer is already ciphertext) or the caller must have separately
/// asserted the content contains no PII; this function still does not (and
/// cannot) inspect content itself, so the boundary is enforced at the API
/// layer that calls this (see routes/assets.routes.ts and
/// routes/fabric/assets.routes.ts), which now requires an explicit
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
  const contentHash = ethers.keccak256(fileBuffer);
  return { cid, contentHash };
}
