import { expect } from "chai";
import { ethers } from "hardhat";

describe("DIDRegistry", function () {
  async function deployFixture() {
    const [safe, user, newKey, recoveryModule] = await ethers.getSigners();
    const DIDRegistry = await ethers.getContractFactory("DIDRegistry");
    const registry = await DIDRegistry.deploy(safe.address);
    const didHash = ethers.keccak256(ethers.toUtf8Bytes("did:ethr:amoy:0xUser"));
    return { safe, user, newKey, recoveryModule, registry, didHash };
  }

  it("registers the caller as controller", async function () {
    const { user, registry, didHash } = await deployFixture();
    await registry.connect(user).registerDID(didHash);
    expect(await registry.getController(didHash)).to.equal(user.address);
  });

  it("lets the controller rotate their own key", async function () {
    const { user, newKey, registry, didHash } = await deployFixture();
    await registry.connect(user).registerDID(didHash);
    await registry.connect(user).updateController(didHash, newKey.address);
    expect(await registry.getController(didHash)).to.equal(newKey.address);
  });

  it("lets the recovery module re-bind a lost key, and blocks everyone else", async function () {
    const { safe, user, newKey, recoveryModule, registry, didHash } = await deployFixture();
    await registry.connect(user).registerDID(didHash);
    await registry.connect(safe).setRecoveryModule(recoveryModule.address);

    await expect(registry.connect(newKey).updateController(didHash, newKey.address)).to.be.reverted;

    await registry.connect(recoveryModule).updateController(didHash, newKey.address);
    expect(await registry.getController(didHash)).to.equal(newKey.address);
  });
});
