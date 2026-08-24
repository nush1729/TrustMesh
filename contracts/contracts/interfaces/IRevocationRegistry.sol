// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Shared on-chain status registry used by both Verifiable Credentials
///         and RBAC role grants. Storing only a bytes32 statusId keeps this
///         registry free of any personally identifiable information.
interface IRevocationRegistry {
    function setStatus(bytes32 statusId, bool revoked) external;
    function isRevoked(bytes32 statusId) external view returns (bool);
    function setExpiry(bytes32 statusId, uint256 expiryTimestamp) external;
    function isExpired(bytes32 statusId) external view returns (bool);
}
