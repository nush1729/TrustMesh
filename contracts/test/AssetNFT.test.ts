import { expect } from "chai";
import { ethers } from "hardhat";

describe("AssetNFT", function () {
  async function deployFixture() {
    const [safe, user, other] = await ethers.getSigners();
    const AssetNFT = await ethers.getContractFactory("AssetNFT");
    const nft = await AssetNFT.deploy(safe.address);
    return { safe, user, other, nft };
  }

  it("only the Safe can mint", async function () {
    const { user, nft } = await deployFixture();
    await expect(
      nft.connect(user).mintAsset(user.address, "ipfs://cid", ethers.keccak256(ethers.toUtf8Bytes("doc")))
    ).to.be.reverted;
  });

  it("mints an asset to the intended owner with metadata", async function () {
    const { safe, user, nft } = await deployFixture();
    const contentHash = ethers.keccak256(ethers.toUtf8Bytes("certificate-doc"));

    const tx = await nft.connect(safe).mintAsset(user.address, "ipfs://cid123", contentHash);
    await tx.wait();

    expect(await nft.ownerOf(0)).to.equal(user.address);
    const meta = await nft.assetMeta(0);
    expect(meta.ipfsCID).to.equal("ipfs://cid123");
    expect(meta.contentHash).to.equal(contentHash);
  });

  it("only the Safe can execute a governed transfer", async function () {
    const { safe, user, other, nft } = await deployFixture();
    const contentHash = ethers.keccak256(ethers.toUtf8Bytes("doc"));
    await nft.connect(safe).mintAsset(user.address, "ipfs://cid", contentHash);

    await expect(nft.connect(user).transferAsset(user.address, other.address, 0)).to.be.reverted;

    await nft.connect(safe).transferAsset(user.address, other.address, 0);
    expect(await nft.ownerOf(0)).to.equal(other.address);
  });
});
