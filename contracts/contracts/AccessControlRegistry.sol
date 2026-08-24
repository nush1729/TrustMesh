// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IRevocationRegistry.sol";

/// @title AccessControlRegistry
/// @notice On-chain RBAC for TrustMesh: Admin / Manager / Auditor / User.
///         Roles are stored as bytes32 hashes (OpenZeppelin AccessControl
///         convention) — never as human-readable "Manager of Dept X" labels,
///         which would be permanent, un-erasable personal data under DPDP.
///         The human-readable role<->org mapping lives off-chain in the
///         backend vault, where it can be corrected or erased.
/// @dev DEFAULT_ADMIN_ROLE is granted only to the Gnosis Safe at deployment,
///      so every role grant/revoke requires multi-sig quorum — removing the
///      single-admin-key failure mode named in the problem statement.
contract AccessControlRegistry is AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("TRUSTMESH_ADMIN_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("TRUSTMESH_MANAGER_ROLE");
    bytes32 public constant AUDITOR_ROLE = keccak256("TRUSTMESH_AUDITOR_ROLE");
    bytes32 public constant USER_ROLE = keccak256("TRUSTMESH_USER_ROLE");

    IRevocationRegistry public revocationRegistry;

    // role => account => expiry timestamp (0 = no expiry set / not granted)
    mapping(bytes32 => mapping(address => uint256)) public roleExpiry;

    event RoleGrantedWithExpiry(bytes32 indexed role, address indexed account, uint256 expiry);
    event RoleRevokedEarly(bytes32 indexed role, address indexed account);

    constructor(address safeAddress, address revocationRegistryAddress) {
        _grantRole(DEFAULT_ADMIN_ROLE, safeAddress);
        revocationRegistry = IRevocationRegistry(revocationRegistryAddress);
    }

    function _statusId(bytes32 role, address account) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(role, account));
    }

    /// @notice Grants a role with an explicit expiry. Only the Safe
    ///         (DEFAULT_ADMIN_ROLE) may call this.
    function grantRoleWithExpiry(bytes32 role, address account, uint256 expiry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(expiry > block.timestamp, "AccessControlRegistry: expiry must be in the future");
        _grantRole(role, account);
        roleExpiry[role][account] = expiry;
        bytes32 statusId = _statusId(role, account);
        revocationRegistry.setStatus(statusId, false);
        revocationRegistry.setExpiry(statusId, expiry);
        emit RoleGrantedWithExpiry(role, account, expiry);
    }

    /// @notice Revokes a role before its natural expiry (e.g. compromised
    ///         key, early end of an audit engagement).
    function revokeRoleEarly(bytes32 role, address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(role, account);
        bytes32 statusId = _statusId(role, account);
        revocationRegistry.setStatus(statusId, true);
        emit RoleRevokedEarly(role, account);
    }

    /// @notice True only if the role was granted, has not expired, and has
    ///         not been explicitly revoked — the full RBAC lifecycle check.
    function hasActiveRole(bytes32 role, address account) external view returns (bool) {
        if (!hasRole(role, account)) return false;
        uint256 expiry = roleExpiry[role][account];
        if (expiry != 0 && block.timestamp > expiry) return false;
        bytes32 statusId = _statusId(role, account);
        if (revocationRegistry.isRevoked(statusId)) return false;
        return true;
    }
}
