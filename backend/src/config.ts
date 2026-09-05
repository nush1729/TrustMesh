import * as dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. See backend/.env.example.`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT || 4000),
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:3000",

  databaseUrl: process.env.DATABASE_URL || "postgres://localhost:5432/trustmesh",

  amoyRpcUrl: process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
  chainId: Number(process.env.CHAIN_ID || 80002),
  chainPrivateKey: process.env.CHAIN_PRIVATE_KEY || "",

  // Local-demo-only: the hosted Safe Transaction Service only indexes real
  // networks (Amoy, mainnet, etc.) — it has no way to see a local Hardhat
  // chain. When true, safe.service.ts bypasses it and executes Safe
  // transactions directly on-chain using two local owner keys below,
  // mirroring the real 2-of-3 approval on-chain (via approveHash) instead
  // of going through the Safe web UI. Never set this against a real network.
  safeLocalMode: process.env.SAFE_LOCAL_MODE === "true",
  localSafeOwnerKeys: [process.env.LOCAL_SAFE_OWNER1_KEY || "", process.env.LOCAL_SAFE_OWNER2_KEY || ""],

  // P3.1: private, self-hosted IPFS (Kubo) replaces the public Pinata SaaS —
  // documents stay on institution-controlled infrastructure instead of a
  // closed, foreign-hosted third party. Points at a local Kubo daemon's RPC
  // API in dev (`ipfs daemon`, default http://127.0.0.1:5001); in production
  // this points at the institution's own Kubo/IPFS Cluster node.
  ipfsApiUrl: process.env.IPFS_API_URL || "http://127.0.0.1:5001",

  piiVaultMasterKey: process.env.PII_VAULT_MASTER_KEY || "",

  sessionSecret: process.env.SESSION_SECRET || "dev-only-insecure-secret-change-me",

  contracts: {
    didRegistry: process.env.DID_REGISTRY_ADDRESS || "",
    revocationRegistry: process.env.REVOCATION_REGISTRY_ADDRESS || "",
    accessControlRegistry: process.env.ACCESS_CONTROL_REGISTRY_ADDRESS || "",
    assetNFT: process.env.ASSET_NFT_ADDRESS || "",
  },

  safeAddress: process.env.GNOSIS_SAFE_ADDRESS || "",
};

export function assertChainConfigured() {
  required("CHAIN_PRIVATE_KEY");
  required("DID_REGISTRY_ADDRESS");
  required("REVOCATION_REGISTRY_ADDRESS");
  required("ACCESS_CONTROL_REGISTRY_ADDRESS");
  required("ASSET_NFT_ADDRESS");
  required("GNOSIS_SAFE_ADDRESS");
}
