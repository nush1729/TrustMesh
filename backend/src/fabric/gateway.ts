import * as grpc from '@grpc/grpc-js';
import { connect, Contract, Gateway, hash, Identity, Network, Signer, signers } from '@hyperledger/fabric-gateway';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { FabricOrgConfig, ORG_KEYS, OrgKey, fabricConfig } from './config';

/**
 * FABRIC GATEWAY CONNECTIONS — replaces chain.service.ts's ethers
 * JsonRpcProvider + Contract setup.
 *
 * This is the single place the rest of the backend imports chain access from,
 * exactly as chain.service.ts was on the EVM stack. The shape of what it
 * exports deliberately mirrors that file: named accessors per logical registry,
 * so call sites read the same way they did before.
 *
 * One gRPC connection and one Gateway per organization. §4 puts Fabric MSP
 * identities in backend services only; holding all three here is the
 * prototype's single-machine affordance for demonstrating 2-of-3 governance
 * (see the note in config.ts).
 */

/** Contract names as registered by the chaincode (chaincode/trustmesh/src/index.ts). */
export const CONTRACTS = {
  DID_REGISTRY: 'DIDRegistry',
  REVOCATION_REGISTRY: 'RevocationRegistry',
  ACCESS_CONTROL_REGISTRY: 'AccessControlRegistry',
  ASSET_NFT: 'AssetNFT',
  GOVERNANCE: 'Governance',
} as const;

interface OrgConnection {
  client: grpc.Client;
  gateway: Gateway;
  network: Network;
}

const connections = new Map<OrgKey, OrgConnection>();

async function newGrpcClient(org: FabricOrgConfig): Promise<grpc.Client> {
  const tlsRootCert = await fs.readFile(org.tlsCertPath);
  return new grpc.Client(org.peerEndpoint, grpc.credentials.createSsl(tlsRootCert), {
    // The test-network's certificates are issued for peer0.orgN.example.com,
    // but we dial localhost — without this override TLS hostname verification
    // fails. This is a local-topology detail, not a certificate-validation
    // bypass: the certificate chain is still fully verified.
    'grpc.ssl_target_name_override': org.peerHostAlias,
  });
}

async function firstFileIn(dir: string): Promise<Buffer> {
  const files = await fs.readdir(dir);
  if (files.length === 0) throw new Error(`No files found in ${dir}`);
  return fs.readFile(path.join(dir, files[0]));
}

async function newIdentity(org: FabricOrgConfig): Promise<Identity> {
  return { mspId: org.mspId, credentials: await firstFileIn(org.certDirPath) };
}

async function newSigner(org: FabricOrgConfig): Promise<Signer> {
  return signers.newPrivateKeySigner(crypto.createPrivateKey(await firstFileIn(org.keyDirPath)));
}

async function openConnection(key: OrgKey): Promise<OrgConnection> {
  const org = fabricConfig.orgs[key];
  const client = await newGrpcClient(org);
  const gateway = connect({
    client,
    identity: await newIdentity(org),
    signer: await newSigner(org),
    hash: hash.sha256,
    // Endorsement has to gather signatures from multiple organizations' peers
    // under the OutOf(2,...) policy, so it needs more headroom than a
    // single-peer call would.
    evaluateOptions: () => ({ deadline: Date.now() + 15_000 }),
    endorseOptions: () => ({ deadline: Date.now() + 30_000 }),
    submitOptions: () => ({ deadline: Date.now() + 30_000 }),
    commitStatusOptions: () => ({ deadline: Date.now() + 60_000 }),
  });
  return { client, gateway, network: gateway.getNetwork(fabricConfig.channelName) };
}

async function getConnection(key: OrgKey): Promise<OrgConnection> {
  let conn = connections.get(key);
  if (!conn) {
    conn = await openConnection(key);
    connections.set(key, conn);
  }
  return conn;
}

/** The channel Network handle for one organization — used by the event indexer. */
export async function getNetwork(key: OrgKey = fabricConfig.primaryOrg): Promise<Network> {
  return (await getConnection(key)).network;
}

/**
 * A contract handle, as that organization.
 *
 * `getContract(CONTRACTS.ACCESS_CONTROL_REGISTRY)` is the direct analogue of
 * importing `accessControlRegistry` from the old chain.service.ts.
 */
export async function getContract(
  contractName: string,
  org: OrgKey = fabricConfig.primaryOrg
): Promise<Contract> {
  const { network } = await getConnection(org);
  return network.getContract(fabricConfig.chaincodeName, contractName);
}

// --- Call helpers ----------------------------------------------------------------

const decoder = new TextDecoder();

/** Read-only chaincode query (no ordering, no commit) — Fabric's `evaluate`. */
export async function evaluate(
  contractName: string,
  fn: string,
  args: string[] = [],
  org: OrgKey = fabricConfig.primaryOrg
): Promise<string> {
  const contract = await getContract(contractName, org);
  return decoder.decode(await contract.evaluateTransaction(fn, ...args));
}

/** State-changing chaincode call: endorse, order, commit. Resolves once committed. */
export async function submit(
  contractName: string,
  fn: string,
  args: string[] = [],
  org: OrgKey = fabricConfig.primaryOrg
): Promise<string> {
  const contract = await getContract(contractName, org);
  return decoder.decode(await contract.submitTransaction(fn, ...args));
}

export async function evaluateJson<T>(
  contractName: string,
  fn: string,
  args: string[] = [],
  org: OrgKey = fabricConfig.primaryOrg
): Promise<T> {
  return JSON.parse(await evaluate(contractName, fn, args, org)) as T;
}

export async function submitJson<T>(
  contractName: string,
  fn: string,
  args: string[] = [],
  org: OrgKey = fabricConfig.primaryOrg
): Promise<T> {
  return JSON.parse(await submit(contractName, fn, args, org)) as T;
}

/**
 * Liveness check used at boot and by /health — the Fabric analogue of the EVM
 * stack's assertChainConfigured(), but actually talking to the network rather
 * than only checking that env vars are set.
 */
export async function pingChaincode(): Promise<{ ok: true; channel: string; chaincode: string }> {
  // DIDExists on a hash that will never exist: cheap, read-only, and proves the
  // full path (gRPC -> TLS -> MSP identity -> channel -> chaincode) works.
  const probe = crypto.createHash('sha256').update('trustmesh.health.probe').digest('hex');
  const result = await evaluate(CONTRACTS.DID_REGISTRY, 'DIDExists', [probe]);
  if (result !== 'false') throw new Error(`Unexpected chaincode health response: ${result}`);
  return { ok: true, channel: fabricConfig.channelName, chaincode: fabricConfig.chaincodeName };
}

export async function closeGateways(): Promise<void> {
  for (const key of ORG_KEYS) {
    const conn = connections.get(key);
    if (!conn) continue;
    conn.gateway.close();
    conn.client.close();
    connections.delete(key);
  }
}
