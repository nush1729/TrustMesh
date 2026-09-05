import * as os from 'os';
import * as path from 'path';

/**
 * Development defaults for the Fabric test run, applied only where the
 * environment has not already set a value — so CI or a developer's own .env
 * always wins.
 *
 * The VC issuer key below is a FIXED, PUBLICLY-KNOWN DEVELOPMENT KEY. It exists
 * so credential issuance is testable without provisioning a secret, and must
 * never be used anywhere real. In production this comes from the dedicated
 * secrets/KMS service the Final Solution §7 requires, never from a config file.
 */
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  // Only has any effect when NODE_ENV === 'test' — see server.fabric.ts.
  RATE_LIMIT_DISABLED: 'true',
  DATABASE_URL: 'postgres://localhost:5432/trustmesh',
  IPFS_API_URL: 'http://127.0.0.1:5001',
  VC_ISSUER_PRIVATE_KEY: '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d',
  PII_VAULT_MASTER_KEY: 'dev-only-test-master-key-0000000000000000000000000000000000000000',
  FABRIC_CHANNEL_NAME: 'trustmesh',
  FABRIC_CHAINCODE_NAME: 'trustmesh',
  FABRIC_TEST_NETWORK_PATH: path.join(os.homedir(), 'fabric', 'fabric-samples', 'test-network'),
  // Keep test runs from clobbering a developer's real indexer checkpoint.
  FABRIC_CHECKPOINT_FILE: path.join(os.tmpdir(), 'trustmesh-test-checkpoint.json'),
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = value;
}
