/**
 * TrustMesh chaincode entrypoint.
 *
 * Five contracts in one chaincode, on one channel. The first four map
 * one-to-one onto the EVM prototype's four Solidity registries; the fifth
 * replaces the Gnosis Safe.
 *
 *   DIDRegistry            <- DIDRegistry.sol
 *   RevocationRegistry     <- RevocationRegistry.sol
 *   AccessControlRegistry  <- AccessControlRegistry.sol
 *   AssetNFT               <- AssetNFT.sol
 *   Governance             <- Gnosis Safe (migration proposal §3)
 *
 * They share one chaincode rather than being deployed separately because they
 * share state transactionally — a governed role grant writes both an
 * AccessControlRegistry record and a RevocationRegistry status in the same
 * transaction, which across separate chaincodes could not be atomic.
 *
 * Callers address a contract by name, e.g. network.getContract('trustmesh',
 * 'AccessControlRegistry') via the Gateway SDK, or
 * `-c '{"Args":["AccessControlRegistry:HasActiveRole", ...]}'` via the peer CLI.
 */

import { AccessControlRegistryContract } from './accesscontrol.contract';
import { AssetNFTContract } from './asset.contract';
import { DIDRegistryContract } from './did.contract';
import { GovernanceContract } from './governance.contract';
import { RevocationRegistryContract } from './revocation.contract';

export { AccessControlRegistryContract } from './accesscontrol.contract';
export { AssetNFTContract } from './asset.contract';
export { DIDRegistryContract } from './did.contract';
export { GovernanceContract } from './governance.contract';
export { RevocationRegistryContract } from './revocation.contract';

export const contracts = [
  DIDRegistryContract,
  RevocationRegistryContract,
  AccessControlRegistryContract,
  AssetNFTContract,
  GovernanceContract,
];
