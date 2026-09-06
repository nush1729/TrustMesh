import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Fabric-specific configuration (migration proposal §2, "Environment variables
 * to add"). Kept separate from src/config.ts so the EVM configuration stays
 * untouched and runnable as the fallback path until Phase 6 cutover.
 *
 * ORGANIZATION MODEL (§3, §4). Fabric X.509/MSP identities belong to backend
 * SERVICES, one per organization — never to citizens. In a real deployment each
 * of the three organizations runs its own backend holding only its own MSP
 * identity, and they approve each other's proposals over the network.
 *
 * For the prototype all three identities are loaded into one process, so the
 * full 2-of-3 governance flow is demonstrable on a single machine. That is the
 * same tradeoff the EVM prototype made with SAFE_LOCAL_MODE, which held two
 * Safe owner keys locally to stand in for clicking "Confirm" in the Safe UI.
 * It is a demo affordance, not the production topology, and is called out as
 * such rather than hidden.
 */

const TEST_NETWORK =
  process.env.FABRIC_TEST_NETWORK_PATH ||
  path.join(process.env.HOME || '', 'fabric', 'fabric-samples', 'test-network');

const orgPath = (org: string, ...rest: string[]) =>
  path.join(TEST_NETWORK, 'organizations', 'peerOrganizations', `${org}.example.com`, ...rest);

export type OrgKey = 'org1' | 'org2' | 'org3';

export interface FabricOrgConfig {
  key: OrgKey;
  mspId: string;
  /** The TrustMesh governance role this organization plays (§3 signer mapping). */
  role: string;
  peerEndpoint: string;
  peerHostAlias: string;
  tlsCertPath: string;
  certDirPath: string;
  keyDirPath: string;
}

function org(key: OrgKey, mspId: string, role: string, port: number): FabricOrgConfig {
  const domain = `${key}.example.com`;
  return {
    key,
    mspId,
    role,
    peerEndpoint: process.env[`FABRIC_${key.toUpperCase()}_PEER_ENDPOINT`] || `localhost:${port}`,
    peerHostAlias: `peer0.${domain}`,
    tlsCertPath: orgPath(key, 'peers', `peer0.${domain}`, 'tls', 'ca.crt'),
    // User1 rather than Admin: the backend service identity is an ordinary
    // network participant, not an org administrator. Nothing in the chaincode
    // grants privilege by MSP role — governance is the threshold, not a title.
    certDirPath: orgPath(key, 'users', `User1@${domain}`, 'msp', 'signcerts'),
    keyDirPath: orgPath(key, 'users', `User1@${domain}`, 'msp', 'keystore'),
  };
}

export const fabricConfig = {
  testNetworkPath: TEST_NETWORK,
  channelName: process.env.FABRIC_CHANNEL_NAME || 'trustmesh',
  chaincodeName: process.env.FABRIC_CHAINCODE_NAME || 'trustmesh',

  /**
   * The organization this backend proposes as by default. Org1 = IssuingDept,
   * the operational tier that initiates day-to-day governed actions.
   */
  primaryOrg: (process.env.FABRIC_PRIMARY_ORG as OrgKey) || 'org1',

  orgs: {
    org1: org('org1', 'Org1MSP', 'IssuingDept', 7051),
    org2: org('org2', 'Org2MSP', 'AuditOrg', 9051),
    org3: org('org3', 'Org3MSP', 'IndependentVerifier', 11051),
  } as Record<OrgKey, FabricOrgConfig>,

  /**
   * Where the durable event-indexer checkpoint lives.
   *
   * §9 requires the checkpointed indexer be built against Fabric's event
   * service from day one rather than retrofitted, because naive listening
   * loses events on reconnect. A file checkpointer is used rather than a new
   * Postgres table because the Postgres schema is explicitly out of scope for
   * this migration.
   */
  checkpointFile: process.env.FABRIC_CHECKPOINT_FILE || path.join(process.cwd(), '.fabric-checkpoint.json'),

  /** secp256k1 key (hex) the backend issues Verifiable Credentials with. */
  vcIssuerPrivateKey: process.env.VC_ISSUER_PRIVATE_KEY || '',
} as const;

export const ORG_KEYS: OrgKey[] = ['org1', 'org2', 'org3'];

/**
 * Fail fast at boot rather than on the first chain call — the Fabric
 * equivalent of the EVM stack's assertChainConfigured().
 */
export function assertFabricConfigured(): void {
  const fs = require('fs') as typeof import('fs');
  for (const key of ORG_KEYS) {
    const o = fabricConfig.orgs[key];
    for (const [label, p] of [
      ['TLS cert', o.tlsCertPath],
      ['signcert dir', o.certDirPath],
      ['keystore dir', o.keyDirPath],
    ] as const) {
      if (!fs.existsSync(p)) {
        throw new Error(
          `Fabric ${label} for ${o.mspId} not found at ${p}. ` +
            `Bring the network up first (./fabric/network-up.sh), or set FABRIC_TEST_NETWORK_PATH.`
        );
      }
    }
  }
}
