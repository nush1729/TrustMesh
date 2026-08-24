import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/// Executes a real 2-of-3 Safe transaction locally: builds the SafeTx hash,
/// has two owners call approveHash() on-chain (a genuine on-chain
/// confirmation — the same mechanism the Safe UI uses under the hood), then
/// executes once the threshold is met. This is the automated equivalent of
/// clicking "Confirm" twice in the Safe web UI.
async function execViaSafe(
  safe: any,
  owners: any[],
  to: string,
  data: string,
  label: string
) {
  const nonce = await safe.nonce();
  const txHash = await safe.getTransactionHash(
    to,
    0,
    data,
    0, // Call
    0, // safeTxGas
    0, // baseGas
    0, // gasPrice
    ethers.ZeroAddress, // gasToken
    ethers.ZeroAddress, // refundReceiver
    nonce
  );

  console.log(`\n→ ${label}`);
  console.log("  SafeTx hash:", txHash);

  // Owner 1 and Owner 2 approve on-chain — the real 2-of-3 confirmation.
  await (await safe.connect(owners[0]).approveHash(txHash)).wait();
  console.log("  ✓ Owner 1 approved");
  await (await safe.connect(owners[1]).approveHash(txHash)).wait();
  console.log("  ✓ Owner 2 approved");

  // Signature encoding for on-chain approvals ("approved hash" format):
  // r = owner address, s = 0, v = 1, per each owner, sorted ascending.
  const approvers = [owners[0].address, owners[1].address].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );
  let signatures = "0x";
  for (const addr of approvers) {
    signatures += addr.slice(2).padStart(64, "0") + "0".repeat(64) + "01";
  }

  const tx = await safe.execTransaction(
    to,
    0,
    data,
    0,
    0,
    0,
    0,
    ethers.ZeroAddress,
    ethers.ZeroAddress,
    signatures
  );
  await tx.wait();
  console.log("  ✅ Executed via Safe (2-of-3)");
}

async function main() {
  const [, owner1, owner2, owner3, demoUser] = await ethers.getSigners();

  const localSafe = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "local-safe.json"), "utf-8"));
  const addresses = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf-8"));

  const safe = await ethers.getContractAt("Safe", localSafe.safeAddress);
  const owners = [owner1, owner2, owner3];

  const revocationRegistry = await ethers.getContractAt("RevocationRegistry", addresses.RevocationRegistry);
  const didRegistry = await ethers.getContractAt("DIDRegistry", addresses.DIDRegistry);
  const accessControlRegistry = await ethers.getContractAt("AccessControlRegistry", addresses.AccessControlRegistry);
  const assetNFT = await ethers.getContractAt("AssetNFT", addresses.AssetNFT);

  // 1. Authorize AccessControlRegistry to write status into RevocationRegistry.
  await execViaSafe(
    safe,
    owners,
    addresses.RevocationRegistry,
    revocationRegistry.interface.encodeFunctionData("setWriterAuthorization", [addresses.AccessControlRegistry, true]),
    "Authorize AccessControlRegistry as a RevocationRegistry writer"
  );

  // 2. Set demoUser's own address as the DID recovery module stand-in
  //    (in production this is the backend relayer; fine for a local demo).
  await execViaSafe(
    safe,
    owners,
    addresses.DIDRegistry,
    didRegistry.interface.encodeFunctionData("setRecoveryModule", [demoUser.address]),
    "Set guardian-recovery module"
  );

  // 3. Grant demoUser the Manager role, 30-day expiry — gives the frontend
  //    something real to display immediately after a fresh local deploy.
  const MANAGER_ROLE = await accessControlRegistry.MANAGER_ROLE();
  const expiry = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  await execViaSafe(
    safe,
    owners,
    addresses.AccessControlRegistry,
    accessControlRegistry.interface.encodeFunctionData("grantRoleWithExpiry", [MANAGER_ROLE, demoUser.address, expiry]),
    `Grant Manager role to demo user (${demoUser.address}), 30-day expiry`
  );

  // 4. Mint a demo asset NFT to the same demo user.
  await execViaSafe(
    safe,
    owners,
    addresses.AssetNFT,
    assetNFT.interface.encodeFunctionData("mintAsset", [
      demoUser.address,
      "ipfs://demo-placeholder-cid",
      ethers.keccak256(ethers.toUtf8Bytes("demo-asset-content")),
    ]),
    "Mint a demo AssetNFT to the demo user"
  );

  console.log("\n✅ Local Safe setup complete.");
  console.log("Demo user address (Manager role + 1 asset):", demoUser.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
