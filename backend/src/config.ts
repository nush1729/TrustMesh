import * as dotenv from "dotenv";

dotenv.config();

/**
 * Process-wide configuration shared by every part of the backend.
 *
 * Fabric-specific settings (MSP paths, channel/chaincode names, per-org
 * gateway identities) deliberately live in src/fabric/config.ts instead, with
 * their own fail-fast assertion — this file holds only what is true regardless
 * of which ledger sits underneath.
 *
 * The EVM/Solidity settings that used to live here (RPC URL, chain id, relayer
 * key, Safe address, the four contract addresses, and SAFE_LOCAL_MODE) were
 * removed when the EVM stack was retired. So was `sessionSecret`, which every
 * caller had already stopped using: sessions are opaque CSPRNG tokens stored
 * only as SHA-256 hashes (see utils/session-token.ts), so there is nothing for
 * a signing secret to do, and leaving it in place only advertised a
 * dev-insecure default that nothing honoured.
 */
export const config = {
  port: Number(process.env.PORT || 4000),
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:3000",

  databaseUrl: process.env.DATABASE_URL || "postgres://localhost:5432/trustmesh",

  // P3.1: private, self-hosted IPFS (Kubo) replaces the public Pinata SaaS —
  // documents stay on institution-controlled infrastructure instead of a
  // closed, foreign-hosted third party. Points at a local Kubo daemon's RPC
  // API in dev (`ipfs daemon`, default http://127.0.0.1:5001); in production
  // this points at the institution's own Kubo/IPFS Cluster node.
  ipfsApiUrl: process.env.IPFS_API_URL || "http://127.0.0.1:5001",

  piiVaultMasterKey: process.env.PII_VAULT_MASTER_KEY || "",
};
