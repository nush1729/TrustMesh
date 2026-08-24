// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IRevocationRegistry.sol";

/// @title RevocationRegistry
/// @notice Shared status registry for Verifiable Credentials AND RBAC role
///         grants. Deliberately stores nothing but opaque bytes32 status ids
///         (never names, roles, or org labels) so it can sit fully public
///         on-chain without becoming personal data under DPDP.
/// @dev Owner is the Gnosis Safe. Authorized writers are added by the owner
///      (the AccessControlRegistry contract and the backend VC-issuance
///      relayer) so day-to-day status updates don't require a full Safe
///      quorum for every single revocation.
contract RevocationRegistry is Ownable, IRevocationRegistry {
    mapping(bytes32 => bool) private _revoked;
    mapping(bytes32 => uint256) private _expiry;
    mapping(address => bool) public authorizedWriters;

    event StatusChanged(bytes32 indexed statusId, bool revoked);
    event ExpirySet(bytes32 indexed statusId, uint256 expiryTimestamp);
    event WriterAuthorized(address indexed writer, bool authorized);

    modifier onlyAuthorizedWriter() {
        require(authorizedWriters[msg.sender] || msg.sender == owner(), "RevocationRegistry: not authorized");
        _;
    }

    constructor(address safeAddress) Ownable(safeAddress) {}

    function setWriterAuthorization(address writer, bool authorized) external onlyOwner {
        authorizedWriters[writer] = authorized;
        emit WriterAuthorized(writer, authorized);
    }

    function setStatus(bytes32 statusId, bool revoked) external onlyAuthorizedWriter {
        _revoked[statusId] = revoked;
        emit StatusChanged(statusId, revoked);
    }

    function setExpiry(bytes32 statusId, uint256 expiryTimestamp) external onlyAuthorizedWriter {
        _expiry[statusId] = expiryTimestamp;
        emit ExpirySet(statusId, expiryTimestamp);
    }

    function isRevoked(bytes32 statusId) external view returns (bool) {
        return _revoked[statusId];
    }

    function isExpired(bytes32 statusId) external view returns (bool) {
        uint256 exp = _expiry[statusId];
        return exp != 0 && block.timestamp > exp;
    }
}
