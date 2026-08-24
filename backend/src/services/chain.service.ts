import { ethers } from "ethers";
import * as path from "path";
import { config } from "../config";

// Loaded directly from the Hardhat build output in ../../contracts, so the
// backend is always calling the exact ABI that was actually deployed —
// never a hand-copied, potentially stale, ABI.
function loadAbi(contractName: string) {
  const artifactPath = path.join(
    __dirname,
    "../../../contracts/artifacts/contracts",
    `${contractName}.sol`,
    `${contractName}.json`
  );
  const artifact = require(artifactPath);
  return artifact.abi;
}

export const provider = new ethers.JsonRpcProvider(config.amoyRpcUrl, config.chainId);

// This relayer key is used ONLY for read calls and for building/submitting
// Safe transaction proposals — it must never itself hold owner/admin rights
// on any TrustMesh contract. All state-changing admin calls require the
// Gnosis Safe's own multi-sig quorum, executed via the Safe Transaction
// Service / SDK, not this key acting alone.
export const relayerWallet = config.chainPrivateKey
  ? new ethers.Wallet(config.chainPrivateKey, provider)
  : undefined;

export const didRegistry = new ethers.Contract(
  config.contracts.didRegistry,
  loadAbi("DIDRegistry"),
  relayerWallet ?? provider
);

export const revocationRegistry = new ethers.Contract(
  config.contracts.revocationRegistry,
  loadAbi("RevocationRegistry"),
  relayerWallet ?? provider
);

export const accessControlRegistry = new ethers.Contract(
  config.contracts.accessControlRegistry,
  loadAbi("AccessControlRegistry"),
  relayerWallet ?? provider
);

export const assetNFT = new ethers.Contract(config.contracts.assetNFT, loadAbi("AssetNFT"), relayerWallet ?? provider);

export const ROLE_HASHES = {
  ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("TRUSTMESH_ADMIN_ROLE")),
  MANAGER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("TRUSTMESH_MANAGER_ROLE")),
  AUDITOR_ROLE: ethers.keccak256(ethers.toUtf8Bytes("TRUSTMESH_AUDITOR_ROLE")),
  USER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("TRUSTMESH_USER_ROLE")),
} as const;

export const ROLE_NAME_TO_HASH: Record<string, string> = {
  Admin: ROLE_HASHES.ADMIN_ROLE,
  Manager: ROLE_HASHES.MANAGER_ROLE,
  Auditor: ROLE_HASHES.AUDITOR_ROLE,
  User: ROLE_HASHES.USER_ROLE,
};

export function didToHash(did: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(did));
}
