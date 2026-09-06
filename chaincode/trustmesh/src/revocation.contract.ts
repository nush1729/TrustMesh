import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import * as registry from './registry';
import { requireArg, stableStringify } from './util';

/**
 * RevocationRegistry — replaces RevocationRegistry.sol.
 *
 * Shared status registry for Verifiable Credentials AND RBAC role grants.
 * Deliberately stores nothing but opaque status ids — never names, roles or
 * org labels — so it can sit fully readable on a shared channel without
 * becoming personal data under DPDP.
 *
 * Reads only. setStatus is privileged and runs solely through
 * Governance.ExecuteProposal (SET_CREDENTIAL_STATUS), or as a side effect of a
 * governed role grant/revoke, mirroring the Solidity version where the
 * AccessControlRegistry contract was an authorized writer.
 */
@Info({ title: 'RevocationRegistry', description: 'Credential and role-grant status — revocation and expiry' })
export class RevocationRegistryContract extends Contract {
  constructor() {
    super('RevocationRegistry');
  }

  /** Mirrors RevocationRegistry.isRevoked(). */
  @Transaction(false)
  @Returns('boolean')
  public async IsRevoked(ctx: Context, statusId: string): Promise<boolean> {
    return registry.isRevoked(ctx, requireArg('statusId', statusId));
  }

  /** Mirrors RevocationRegistry.isExpired(); expiry 0 means "no expiry set". */
  @Transaction(false)
  @Returns('boolean')
  public async IsExpired(ctx: Context, statusId: string): Promise<boolean> {
    return registry.isExpired(ctx, requireArg('statusId', statusId));
  }

  /** Full status record, or an explicit "never set" default. */
  @Transaction(false)
  @Returns('string')
  public async GetStatus(ctx: Context, statusId: string): Promise<string> {
    const id = requireArg('statusId', statusId);
    const record = await registry.readStatus(ctx, id);
    if (!record) {
      return stableStringify({ statusId: id, revoked: false, expiry: '0', updatedAt: '' });
    }
    return stableStringify(record);
  }
}
