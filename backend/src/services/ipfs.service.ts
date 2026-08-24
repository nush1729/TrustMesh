import { ethers } from "ethers";
import { config } from "../config";

const PINATA_PIN_JSON_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS";
const PINATA_PIN_FILE_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";

function requirePinataJwt(): string {
  if (!config.pinataJwt) {
    throw new Error("PINATA_JWT not set — see backend/.env.example for how to get one.");
  }
  return config.pinataJwt;
}

/// Uploads asset metadata (never raw PII — see vault.service.ts) to IPFS via
/// Pinata and returns the CID plus a keccak256 content hash suitable for
/// anchoring on-chain in AssetNFT.mintAsset.
export async function uploadJsonToIpfs(data: Record<string, unknown>): Promise<{ cid: string; contentHash: string }> {
  const jwt = requirePinataJwt();
  const res = await fetch(PINATA_PIN_JSON_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ pinataContent: data }),
  });
  if (!res.ok) throw new Error(`Pinata JSON upload failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { IpfsHash: string };
  const contentHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(data)));
  return { cid: body.IpfsHash, contentHash };
}

/// Uploads a raw file (e.g. an asset document) to IPFS. Caller is
/// responsible for encrypting the buffer first if it may contain PII —
/// this function does not inspect content.
export async function uploadFileToIpfs(fileBuffer: Buffer, fileName: string): Promise<{ cid: string; contentHash: string }> {
  const jwt = requirePinataJwt();
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(fileBuffer)]), fileName);

  const res = await fetch(PINATA_PIN_FILE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Pinata file upload failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { IpfsHash: string };
  const contentHash = ethers.keccak256(fileBuffer);
  return { cid: body.IpfsHash, contentHash };
}
