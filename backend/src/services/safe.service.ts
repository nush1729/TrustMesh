import Safe from "@safe-global/protocol-kit";
import SafeApiKit from "@safe-global/api-kit";
import { ethers } from "ethers";
import * as path from "path";
import { config } from "../config";
import { provider, relayerWallet } from "./chain.service";

// This is the single chokepoint that stands between "an admin clicked a
// button" and "state actually changed on-chain." The backend relayer key
// PROPOSES a transaction to the Gnosis Safe; it can never execute one alone.
// Execution only happens once enough of the Safe's own owners (independent
// of this backend) have co-signed via the Safe{Wallet} UI or SDK, meeting
// the Safe's configured threshold (e.g. 2-of-3).
//
// LOCAL DEMO EXCEPTION: the hosted Safe Transaction Service used below only
// indexes real networks — it cannot see a local Hardhat chain. When
// config.safeLocalMode is set, this module instead executes the real
// on-chain 2-of-3 approval directly (via Safe's approveHash + execTransaction,
// the same mechanism the Safe UI uses), using two local owner keys. This is
// a local-only substitute for clicking "Confirm" in the Safe web UI — never
// enable it against a real network.

const SAFE_TX_SERVICE_URL = "https://safe-transaction-amoy.safe.global";

function loadSafeAbi() {
  const artifactPath = path.join(__dirname, "../../../contracts/artifacts/contracts/safe-vendor/Safe.sol/Safe.json");
  return require(artifactPath).abi;
}

async function getProtocolKit() {
  if (!config.chainPrivateKey) {
    throw new Error("CHAIN_PRIVATE_KEY not set — cannot build Safe proposals.");
  }
  return Safe.init({
    provider: config.amoyRpcUrl,
    signer: config.chainPrivateKey,
    safeAddress: config.safeAddress,
  });
}

function getApiKit() {
  return new SafeApiKit({ chainId: BigInt(config.chainId), txServiceUrl: SAFE_TX_SERVICE_URL });
}

async function executeLocalSafeTransaction(to: string, data: string, value: string): Promise<{ safeTxHash: string; executionTxHash: string }> {
  if (config.localSafeOwnerKeys.some((k) => !k)) {
    throw new Error("SAFE_LOCAL_MODE is on but LOCAL_SAFE_OWNER1_KEY / LOCAL_SAFE_OWNER2_KEY are not set.");
  }
  if (!relayerWallet) throw new Error("CHAIN_PRIVATE_KEY not set.");

  const safe = new ethers.Contract(config.safeAddress, loadSafeAbi(), relayerWallet);
  const owner1 = new ethers.Wallet(config.localSafeOwnerKeys[0], provider);
  const owner2 = new ethers.Wallet(config.localSafeOwnerKeys[1], provider);

  const nonce = await safe.nonce();
  const safeTxHash: string = await safe.getTransactionHash(
    to, value, data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, nonce
  );

  await (await (safe.connect(owner1) as ethers.Contract).approveHash(safeTxHash)).wait();
  await (await (safe.connect(owner2) as ethers.Contract).approveHash(safeTxHash)).wait();

  const approvers = [owner1.address, owner2.address].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  let signatures = "0x";
  for (const addr of approvers) {
    signatures += addr.slice(2).padStart(64, "0") + "0".repeat(64) + "01";
  }

  const execTx = await safe.execTransaction(to, value, data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, signatures);
  const receipt = await execTx.wait();

  return { safeTxHash, executionTxHash: receipt.hash };
}

/// Proposes a single contract call (role grant/revoke, asset mint/transfer)
/// to the Safe. Returns the safeTxHash the frontend polls for co-signer
/// confirmations against. In local-demo mode, the "proposal" is executed
/// immediately via the real on-chain 2-of-3 flow instead of waiting on the
/// hosted transaction service.
export async function proposeSafeTransaction(to: string, data: string, value = "0"): Promise<{ safeTxHash: string }> {
  if (config.safeLocalMode) {
    const { safeTxHash } = await executeLocalSafeTransaction(to, data, value);
    return { safeTxHash };
  }

  const protocolKit = await getProtocolKit();
  const apiKit = getApiKit();

  const safeTransaction = await protocolKit.createTransaction({
    transactions: [{ to, data, value }],
  });

  const safeTxHash = await protocolKit.getTransactionHash(safeTransaction);
  const signature = await protocolKit.signHash(safeTxHash);

  await apiKit.proposeTransaction({
    safeAddress: config.safeAddress,
    safeTransactionData: safeTransaction.data,
    safeTxHash,
    senderAddress: await (await protocolKit.getSafeProvider().getSignerAddress()) as string,
    senderSignature: signature.data,
  });

  return { safeTxHash };
}

export async function getSafeTransactionStatus(safeTxHash: string) {
  if (config.safeLocalMode) {
    // Local mode executes synchronously inside proposeSafeTransaction, so by
    // the time the frontend polls this, it has already landed on-chain.
    return { isExecuted: true, confirmations: 2, threshold: 2, executionTxHash: safeTxHash };
  }

  const apiKit = getApiKit();
  const tx = await apiKit.getTransaction(safeTxHash);
  const threshold = await apiKit.getSafeInfo(config.safeAddress).then((i) => i.threshold);
  return {
    isExecuted: tx.isExecuted,
    confirmations: tx.confirmations?.length ?? 0,
    threshold,
    executionTxHash: tx.transactionHash,
  };
}
