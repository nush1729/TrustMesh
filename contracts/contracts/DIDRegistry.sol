// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title DIDRegistry
/// @notice Anchors the controller key for a did:ethr-style decentralized
///         identifier. Stores ONLY a hash of the DID and its controller
///         address — no names, documents, or other personal data ever touch
///         this contract.
/// @dev Guardian-based social recovery is supported via a designated
///      recoveryModule address (the backend recovery service), which is the
///      only address other than the current controller allowed to re-bind a
///      DID to a new controller key after an off-chain M-of-N guardian vote.
contract DIDRegistry is Ownable {
    struct DIDRecord {
        address controller;
        uint256 registeredAt;
        bool exists;
    }

    mapping(bytes32 => DIDRecord) private _records;
    address public recoveryModule;

    event DIDRegistered(bytes32 indexed didHash, address indexed controller);
    event ControllerUpdated(bytes32 indexed didHash, address indexed oldController, address indexed newController);
    event RecoveryModuleUpdated(address indexed recoveryModule);

    constructor(address safeAddress) Ownable(safeAddress) {}

    function setRecoveryModule(address module) external onlyOwner {
        recoveryModule = module;
        emit RecoveryModuleUpdated(module);
    }

    /// @notice Self-registration: the caller becomes the controller of the DID.
    function registerDID(bytes32 didHash) external {
        require(!_records[didHash].exists, "DIDRegistry: already registered");
        _records[didHash] = DIDRecord({controller: msg.sender, registeredAt: block.timestamp, exists: true});
        emit DIDRegistered(didHash, msg.sender);
    }

    /// @notice Re-binds a DID to a new controller key. Callable by the
    ///         current controller (normal key rotation) or by the guardian
    ///         recovery module (lost-key recovery after an off-chain vote).
    function updateController(bytes32 didHash, address newController) external {
        DIDRecord storage record = _records[didHash];
        require(record.exists, "DIDRegistry: unknown DID");
        require(
            msg.sender == record.controller || msg.sender == recoveryModule,
            "DIDRegistry: not authorized to update controller"
        );
        address old = record.controller;
        record.controller = newController;
        emit ControllerUpdated(didHash, old, newController);
    }

    function getController(bytes32 didHash) external view returns (address) {
        require(_records[didHash].exists, "DIDRegistry: unknown DID");
        return _records[didHash].controller;
    }

    function exists(bytes32 didHash) external view returns (bool) {
        return _records[didHash].exists;
    }
}
