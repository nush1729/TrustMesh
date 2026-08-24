import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/// Deploys a REAL Gnosis Safe (v1.4.1) to the local Hardhat node — genuine
/// multi-sig contracts, genuine 2-of-3 threshold, zero real money involved.
/// Uses three of Hardhat's pre-funded local accounts as stand-in "team
/// owners" so the full multi-sig approval flow can be demoed end-to-end
/// without touching a public testnet.
async function main() {
  const [deployer, owner1, owner2, owner3] = await ethers.getSigners();

  console.log("Deploying Safe singleton + factory with:", deployer.address);
  console.log("Owner 1 (stand-in):", owner1.address);
  console.log("Owner 2 (stand-in):", owner2.address);
  console.log("Owner 3 (stand-in):", owner3.address);

  const Safe = await ethers.getContractFactory("Safe");
  const safeSingleton = await Safe.deploy();
  await safeSingleton.waitForDeployment();
  console.log("Safe singleton:", await safeSingleton.getAddress());

  const SafeProxyFactory = await ethers.getContractFactory("SafeProxyFactory");
  const factory = await SafeProxyFactory.deploy();
  await factory.waitForDeployment();
  console.log("SafeProxyFactory:", await factory.getAddress());

  const owners = [owner1.address, owner2.address, owner3.address];
  const threshold = 2;

  const setupData = Safe.interface.encodeFunctionData("setup", [
    owners,
    threshold,
    ethers.ZeroAddress, // to
    "0x", // data
    ethers.ZeroAddress, // fallbackHandler
    ethers.ZeroAddress, // paymentToken
    0, // payment
    ethers.ZeroAddress, // paymentReceiver
  ]);

  const saltNonce = Date.now();
  const tx = await factory.createProxyWithNonce(await safeSingleton.getAddress(), setupData, saltNonce);
  const receipt = await tx.wait();

  const event = receipt!.logs
    .map((log) => {
      try {
        return factory.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((e) => e?.name === "ProxyCreation");

  const safeAddress = event!.args.proxy;
  console.log("\n✅ Local Safe deployed at:", safeAddress);
  console.log("   Owners:", owners.join(", "));
  console.log("   Threshold: 2-of-3");

  const outPath = path.join(__dirname, "..", "local-safe.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        safeAddress,
        singleton: await safeSingleton.getAddress(),
        factory: await factory.getAddress(),
        owners,
        threshold,
        ownerPrivateKeysNote: "Owner private keys are Hardhat's standard local test accounts #1, #2, #3 (see `npx hardhat node` output).",
      },
      null,
      2
    )
  );
  console.log("\nWritten to", outPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
