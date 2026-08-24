// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title AssetNFT
/// @notice ERC-721 for real digital/physical assets ONLY (certificates,
///         equipment, licenses) — never used to represent identity or roles.
///         Full metadata lives on IPFS; only its content hash is anchored
///         on-chain. Minting and governed transfer are restricted to the
///         Gnosis Safe, never a single admin key.
contract AssetNFT is ERC721, Ownable {
    uint256 private _nextTokenId;

    struct AssetMeta {
        string ipfsCID;
        bytes32 contentHash;
        uint256 mintedAt;
    }

    mapping(uint256 => AssetMeta) public assetMeta;

    event AssetMinted(uint256 indexed tokenId, address indexed to, string ipfsCID, bytes32 contentHash);
    event AssetTransferred(uint256 indexed tokenId, address indexed from, address indexed to);

    constructor(address safeAddress) ERC721("TrustMesh Asset", "TMA") Ownable(safeAddress) {}

    /// @notice Mints a new asset NFT. Only callable by the Safe.
    function mintAsset(address to, string calldata ipfsCID, bytes32 contentHash) external onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        assetMeta[tokenId] = AssetMeta({ipfsCID: ipfsCID, contentHash: contentHash, mintedAt: block.timestamp});
        emit AssetMinted(tokenId, to, ipfsCID, contentHash);
        return tokenId;
    }

    /// @notice Governed transfer: bypasses standard ERC-721 approval checks
    ///         because custody changes in TrustMesh are institutional
    ///         decisions executed by the Safe, not peer-to-peer trades.
    function transferAsset(address from, address to, uint256 tokenId) external onlyOwner {
        require(_ownerOf(tokenId) == from, "AssetNFT: from is not current owner");
        _update(to, tokenId, address(0));
        emit AssetTransferred(tokenId, from, to);
    }

    function getAssetOwner(uint256 tokenId) external view returns (address) {
        return ownerOf(tokenId);
    }
}
