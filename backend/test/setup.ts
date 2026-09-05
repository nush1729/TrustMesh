import { ethers } from "ethers";
import * as path from "path";
import request from "supertest";
import type { Express } from "express";
import { config } from "../src/config";
import { buildDid } from "../src/services/did.service";

// Test wallets — Hardhat's standard local test accounts (well-known, never
// used on a real network). Accounts #1/#2 are the local Safe's two owners
// (see contracts/local-safe.json); everything below uses accounts NOT
// already spoken for by owners/relayer/demo-user, so tests don't collide
// with contracts/scripts/localSafeSetup.ts's demo state.
export const provider = new ethers.JsonRpcProvider(config.amoyRpcUrl, config.chainId);

export const owner1 = new ethers.Wallet("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", provider);
export const owner2 = new ethers.Wallet("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", provider);

export const adminA = new ethers.Wallet("0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e", provider); // account #6
export const adminB = new ethers.Wallet("0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356", provider); // account #7
export const victim = new ethers.Wallet("0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97", provider); // account #8
export const attacker = new ethers.Wallet("0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6", provider); // account #9

function loadAbi(contractName: string) {
  const artifactPath = path.join(
    __dirname,
    "../../contracts/artifacts/contracts",
    `${contractName}.sol`,
    `${contractName}.json`
  );
  return require(artifactPath).abi;
}

function loadSafeAbi() {
  const artifactPath = path.join(__dirname, "../../contracts/artifacts/contracts/safe-vendor/Safe.sol/Safe.json");
  return require(artifactPath).abi;
}

// Explicit, manually-tracked EOA nonces for owner1/owner2 — sidesteps any
// "pending nonce" staleness between back-to-back transactions from the same
// signer within a single test run (owner1 signs twice per governed call
// here: once to approveHash, once to execTransaction).
const nonceCache = new Map<string, number>();

async function takeNonce(wallet: ethers.Wallet): Promise<number> {
  let nonce = nonceCache.get(wallet.address);
  if (nonce === undefined) {
    nonce = await provider.getTransactionCount(wallet.address, "latest");
  }
  nonceCache.set(wallet.address, nonce + 1);
  return nonce;
}

/// Executes an arbitrary contract call through the real local 2-of-3 Safe
/// (same mechanism contracts/scripts/localSafeSetup.ts uses) — needed so
/// test wallets can hold a genuine on-chain Admin role for requireRole(...)
/// checks, exactly as a real deployment would grant it.
async function execViaSafe(to: string, data: string) {
  const safe = new ethers.Contract(config.safeAddress, loadSafeAbi(), provider);
  const nonce = await safe.nonce();
  const txHash: string = await safe.getTransactionHash(to, 0, data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, nonce);

  const owner1ApproveNonce = await takeNonce(owner1);
  await (await (safe.connect(owner1) as ethers.Contract).approveHash(txHash, { nonce: owner1ApproveNonce })).wait();

  const owner2ApproveNonce = await takeNonce(owner2);
  await (await (safe.connect(owner2) as ethers.Contract).approveHash(txHash, { nonce: owner2ApproveNonce })).wait();

  const approvers = [owner1.address, owner2.address].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  let signatures = "0x";
  for (const addr of approvers) {
    signatures += addr.slice(2).padStart(64, "0") + "0".repeat(64) + "01";
  }
  const execNonce = await takeNonce(owner1);
  const tx = await (safe.connect(owner1) as ethers.Contract).execTransaction(
    to, 0, data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, signatures, { nonce: execNonce }
  );
  await tx.wait();
}

export async function grantAdminRole(account: string, expirySecondsFromNow = 365 * 24 * 60 * 60) {
  const accessControlRegistry = new ethers.Contract(
    config.contracts.accessControlRegistry,
    loadAbi("AccessControlRegistry"),
    provider
  );
  const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("TRUSTMESH_ADMIN_ROLE"));
  const expiry = Math.floor(Date.now() / 1000) + expirySecondsFromNow;
  const data = accessControlRegistry.interface.encodeFunctionData("grantRoleWithExpiry", [ADMIN_ROLE, account, expiry]);
  await execViaSafe(config.contracts.accessControlRegistry, data);
}

export async function registerDidOnChain(wallet: ethers.Wallet) {
  const didRegistry = new ethers.Contract(config.contracts.didRegistry, loadAbi("DIDRegistry"), wallet);
  const { didHash } = buildDid(wallet.address);
  try {
    await (await didRegistry.registerDID(didHash)).wait();
  } catch {
    // already registered — fine for repeated test runs
  }
}

/// Full signed-DID-challenge login flow against the app, mirroring exactly
/// what the real frontend does. Returns a supertest agent with the session
/// cookie already attached for subsequent requests.
export async function loginAs(app: Express, wallet: ethers.Wallet) {
  const agent = request.agent(app);
  const challengeRes = await agent.post("/auth/challenge").send({ address: wallet.address });
  if (challengeRes.status !== 200) {
    throw new Error(`challenge failed: ${challengeRes.status} ${JSON.stringify(challengeRes.body)}`);
  }
  const { nonce } = challengeRes.body as { nonce: string };
  const message = `TrustMesh DID challenge: ${nonce}`;
  const signature = await wallet.signMessage(message);

  const verifyRes = await agent.post("/auth/verify").send({ address: wallet.address, signature, nonce });
  if (verifyRes.status !== 200) {
    throw new Error(`verify failed: ${verifyRes.status} ${JSON.stringify(verifyRes.body)}`);
  }
  return agent;
}
