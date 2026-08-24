import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/// Post-deploy wiring that must be executed BY THE SAFE (not the deployer
/// key) in a real multi-sig setup — run this against a signer that is
/// actually a Safe owner co-signing through the Safe UI/SDK, or adapt it
/// into Safe Transaction Builder batches. Kept as a plain Hardhat script
/// here so the two wiring calls are explicit and auditable rather than
/// buried inside deploy.ts.
async function main() {
  const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
  if (!fs.existsSync(addressesPath)) {
    throw new Error("deployed-addresses.json not found — run `npm run deploy:amoy` first.");
  }
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf-8"));

  const relayerAddress = process.env.BACKEND_RELAYER_ADDRESS;
  if (!relayerAddress) {
    throw new Error("Set BACKEND_RELAYER_ADDRESS (the address for backend/.env's CHAIN_PRIVATE_KEY).");
  }

  const [signer] = await ethers.getSigners();
  console.log("Configuring with signer:", signer.address, "(must be a Safe owner / the Safe itself)");

  const revocationRegistry = await ethers.getContractAt("RevocationRegistry", addresses.RevocationRegistry, signer);
  const tx1 = await revocationRegistry.setWriterAuthorization(addresses.AccessControlRegistry, true);
  await tx1.wait();
  console.log("Authorized AccessControlRegistry to write RevocationRegistry status.");

  const didRegistry = await ethers.getContractAt("DIDRegistry", addresses.DIDRegistry, signer);
  const tx2 = await didRegistry.setRecoveryModule(relayerAddress);
  await tx2.wait();
  console.log("Set backend relayer as DIDRegistry.recoveryModule for guardian recovery execution.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
