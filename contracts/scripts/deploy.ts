import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const safeAddress = process.env.GNOSIS_SAFE_ADDRESS;
  if (!safeAddress) {
    throw new Error("Set GNOSIS_SAFE_ADDRESS in contracts/.env before deploying");
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Safe (admin/owner) address:", safeAddress);

  const RevocationRegistry = await ethers.getContractFactory("RevocationRegistry");
  const revocationRegistry = await RevocationRegistry.deploy(safeAddress);
  await revocationRegistry.waitForDeployment();
  console.log("RevocationRegistry:", await revocationRegistry.getAddress());

  const DIDRegistry = await ethers.getContractFactory("DIDRegistry");
  const didRegistry = await DIDRegistry.deploy(safeAddress);
  await didRegistry.waitForDeployment();
  console.log("DIDRegistry:", await didRegistry.getAddress());

  const AccessControlRegistry = await ethers.getContractFactory("AccessControlRegistry");
  const accessControlRegistry = await AccessControlRegistry.deploy(
    safeAddress,
    await revocationRegistry.getAddress()
  );
  await accessControlRegistry.waitForDeployment();
  console.log("AccessControlRegistry:", await accessControlRegistry.getAddress());

  const AssetNFT = await ethers.getContractFactory("AssetNFT");
  const assetNFT = await AssetNFT.deploy(safeAddress);
  await assetNFT.waitForDeployment();
  console.log("AssetNFT:", await assetNFT.getAddress());

  // Authorize AccessControlRegistry to write role status into RevocationRegistry.
  // This still requires a Safe transaction in production; on a dev/testnet
  // deploy where the deployer key IS the Safe signer used for setup, this
  // call is left here for convenience and should be executed via the Safe
  // UI/SDK for a real multi-sig deployment.
  console.log(
    "\nNEXT STEP: from the Gnosis Safe, call " +
      "RevocationRegistry.setWriterAuthorization(AccessControlRegistryAddress, true) " +
      "so role grants/revocations can write status."
  );

  const addresses = {
    network: "amoy",
    safeAddress,
    RevocationRegistry: await revocationRegistry.getAddress(),
    DIDRegistry: await didRegistry.getAddress(),
    AccessControlRegistry: await accessControlRegistry.getAddress(),
    AssetNFT: await assetNFT.getAddress(),
  };

  const outPath = path.join(__dirname, "..", "deployed-addresses.json");
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log("\nAddresses written to", outPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
