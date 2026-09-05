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
export async function uploadJsonToIpfs(data: Record<string, unknown>): Promise<{ cid: string; contentHash: string }> {
  const json = JSON.stringify(data);
  const cid = await addToIpfs(new Blob([json], { type: "application/json" }), "data.json");
  const contentHash = ethers.keccak256(ethers.toUtf8Bytes(json));
  return { cid, contentHash };
}

/// Uploads a raw file (e.g. an asset document) to the private IPFS node.
/// Caller is responsible for encrypting the buffer first if it may contain
/// PII — this function does not inspect content.
export async function uploadFileToIpfs(fileBuffer: Buffer, fileName: string): Promise<{ cid: string; contentHash: string }> {
  const cid = await addToIpfs(new Blob([Uint8Array.from(fileBuffer)]), fileName);
  const contentHash = ethers.keccak256(fileBuffer);
  return { cid, contentHash };
}
