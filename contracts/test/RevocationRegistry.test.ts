import { expect } from "chai";
import { ethers } from "hardhat";

describe("RevocationRegistry", function () {
  async function deployFixture() {
    const [safe, writer, other] = await ethers.getSigners();
    const RevocationRegistry = await ethers.getContractFactory("RevocationRegistry");
    const registry = await RevocationRegistry.deploy(safe.address);
    const statusId = ethers.keccak256(ethers.toUtf8Bytes("some-credential-or-role-status-id"));
    return { safe, writer, other, registry, statusId };
  }

  it("only the owner (Safe) can authorize a writer", async function () {
    const { other, writer, registry } = await deployFixture();
    await expect(registry.connect(other).setWriterAuthorization(writer.address, true)).to.be.reverted;
  });

  it("rejects status writes from an unauthorized address", async function () {
    const { other, registry, statusId } = await deployFixture();
    await expect(registry.connect(other).setStatus(statusId, true)).to.be.revertedWith(
      "RevocationRegistry: not authorized"
    );
  });

  it("lets an authorized writer set and read revocation status", async function () {
    const { safe, writer, registry, statusId } = await deployFixture();
    await registry.connect(safe).setWriterAuthorization(writer.address, true);

    expect(await registry.isRevoked(statusId)).to.equal(false);
    await registry.connect(writer).setStatus(statusId, true);
    expect(await registry.isRevoked(statusId)).to.equal(true);
  });

  it("computes expiry correctly", async function () {
    const { safe, registry, statusId } = await deployFixture();
    await registry.connect(safe).setWriterAuthorization(safe.address, true);

    const latestBlock = await ethers.provider.getBlock("latest");
    const nearExpiry = (latestBlock?.timestamp ?? 0) + 60;
    await registry.connect(safe).setExpiry(statusId, nearExpiry);

    expect(await registry.isExpired(statusId)).to.equal(false);
    await ethers.provider.send("evm_increaseTime", [120]);
    await ethers.provider.send("evm_mine", []);
    expect(await registry.isExpired(statusId)).to.equal(true);
  });
});
