import { expect } from "chai";
import { ethers } from "hardhat";

describe("AccessControlRegistry", function () {
  async function deployFixture() {
    const [safe, manager, other] = await ethers.getSigners();

    const RevocationRegistry = await ethers.getContractFactory("RevocationRegistry");
    const revocationRegistry = await RevocationRegistry.deploy(safe.address);

    const AccessControlRegistry = await ethers.getContractFactory("AccessControlRegistry");
    const acr = await AccessControlRegistry.deploy(safe.address, await revocationRegistry.getAddress());

    // Safe authorizes the AccessControlRegistry to write role status.
    await revocationRegistry.connect(safe).setWriterAuthorization(await acr.getAddress(), true);

    return { safe, manager, other, revocationRegistry, acr };
  }

  it("only the Safe can grant a role", async function () {
    const { manager, other, acr } = await deployFixture();
    const MANAGER_ROLE = await acr.MANAGER_ROLE();
    const futureExpiry = Math.floor(Date.now() / 1000) + 3600;

    await expect(
      acr.connect(other).grantRoleWithExpiry(MANAGER_ROLE, manager.address, futureExpiry)
    ).to.be.reverted;
  });

  it("grants a role with expiry and reports it active", async function () {
    const { safe, manager, acr } = await deployFixture();
    const MANAGER_ROLE = await acr.MANAGER_ROLE();
    const futureExpiry = Math.floor(Date.now() / 1000) + 3600;

    await acr.connect(safe).grantRoleWithExpiry(MANAGER_ROLE, manager.address, futureExpiry);

    expect(await acr.hasActiveRole(MANAGER_ROLE, manager.address)).to.equal(true);
  });

  it("treats an expired role grant as inactive", async function () {
    const { safe, manager, acr } = await deployFixture();
    const MANAGER_ROLE = await acr.MANAGER_ROLE();
    const latestBlock = await ethers.provider.getBlock("latest");
    const nearExpiry = (latestBlock?.timestamp ?? Math.floor(Date.now() / 1000)) + 60;

    await acr.connect(safe).grantRoleWithExpiry(MANAGER_ROLE, manager.address, nearExpiry);

    // Fast-forward the chain past the expiry instead of racing real time.
    await ethers.provider.send("evm_increaseTime", [120]);
    await ethers.provider.send("evm_mine", []);

    expect(await acr.hasActiveRole(MANAGER_ROLE, manager.address)).to.equal(false);
  });

  it("treats an early-revoked role as inactive even before its expiry", async function () {
    const { safe, manager, acr } = await deployFixture();
    const MANAGER_ROLE = await acr.MANAGER_ROLE();
    const futureExpiry = Math.floor(Date.now() / 1000) + 3600;

    await acr.connect(safe).grantRoleWithExpiry(MANAGER_ROLE, manager.address, futureExpiry);
    await acr.connect(safe).revokeRoleEarly(MANAGER_ROLE, manager.address);

    expect(await acr.hasActiveRole(MANAGER_ROLE, manager.address)).to.equal(false);
  });
});
