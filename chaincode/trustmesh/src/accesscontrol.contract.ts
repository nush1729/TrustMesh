import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import * as registry from './registry';
import { DOC_TYPE, RoleRecord } from './types';
import { requireArg, stableStringify, statusIdFor } from './util';

/**
 * AccessControlRegistry — replaces AccessControlRegistry.sol.
 *
 * RBAC for TrustMesh: Admin / Manager / Auditor / User. Roles are stored as
 * opaque `roleId` hashes, exactly as the Solidity version stored bytes32
 * keccak hashes — never as human-readable "Manager of Department X" labels,
 * which would be permanent, un-erasable personal data under DPDP. The
 * human-readable role/org mapping lives off-chain in the Postgres vault, where
 * it can be corrected or erased.
 *
 * Only READS are exposed here. grantRoleWithExpiry and revokeRoleEarly are
 * privileged and reachable solely through Governance.ExecuteProposal — the
 * equivalent of the Solidity version's `onlyRole(DEFAULT_ADMIN_ROLE)` gate
 * where DEFAULT_ADMIN_ROLE was held exclusively by the Safe.
 */
@Info({ title: 'AccessControlRegistry', description: 'Role-based access control with expiry and revocation' })
export class AccessControlRegistryContract extends Contract {
  constructor() {
    super('AccessControlRegistry');
  }

  /**
   * Mirrors AccessControlRegistry.hasActiveRole() — true only if the role was
   * granted, has not expired, and has not been explicitly revoked.
   *
   * This is the call every privileged backend route re-checks before acting, so
   * authorization is read live from ledger state rather than from a session
   * claim or a cached database row.
   */
  @Transaction(false)
  @Returns('boolean')
  public async HasActiveRole(ctx: Context, roleId: string, subject: string): Promise<boolean> {
    return registry.hasActiveRole(ctx, requireArg('roleId', roleId), requireArg('subject', subject));
  }

  /** The grant record itself — grantedAt, expiry, granted flag. */
  @Transaction(false)
  @Returns('string')
  public async GetRole(ctx: Context, roleId: string, subject: string): Promise<string> {
    const record = await registry.readRole(ctx, requireArg('roleId', roleId), requireArg('subject', subject));
    if (!record) throw new Error('AccessControlRegistry: role not granted');
    return stableStringify(record);
  }

  /** The status id this grant shares with the revocation registry. */
  @Transaction(false)
  @Returns('string')
  public async GetStatusId(ctx: Context, roleId: string, subject: string): Promise<string> {
    return statusIdFor(requireArg('roleId', roleId), requireArg('subject', subject));
  }

  /**
   * Every role held by one identity — what a user's portal page renders.
   *
   * A CouchDB rich query. Fabric's default LevelDB state database cannot
   * answer this without a full scan, which is exactly why CouchDB is set at
   * network bring-up rather than retrofitted (§9, "Rich lookups").
   */
  @Transaction(false)
  @Returns('string')
  public async QueryRolesBySubject(ctx: Context, subject: string): Promise<string> {
    const query = { selector: { docType: DOC_TYPE.ROLE, subject: requireArg('subject', subject) } };
    const iterator = await ctx.stub.getQueryResult(JSON.stringify(query));
    const results: RoleRecord[] = [];
    for (let res = await iterator.next(); !res.done; res = await iterator.next()) {
      results.push(JSON.parse(res.value.value.toString()) as RoleRecord);
    }
    await iterator.close();
    results.sort((a, b) => (a.grantedAt < b.grantedAt ? 1 : -1));
    return stableStringify(results);
  }

  /** Every identity holding one role — the admin console's role roster. */
  @Transaction(false)
  @Returns('string')
  public async QuerySubjectsByRole(ctx: Context, roleId: string): Promise<string> {
    const query = { selector: { docType: DOC_TYPE.ROLE, roleId: requireArg('roleId', roleId), granted: true } };
    const iterator = await ctx.stub.getQueryResult(JSON.stringify(query));
    const results: RoleRecord[] = [];
    for (let res = await iterator.next(); !res.done; res = await iterator.next()) {
      results.push(JSON.parse(res.value.value.toString()) as RoleRecord);
    }
    await iterator.close();
    results.sort((a, b) => (a.grantedAt < b.grantedAt ? 1 : -1));
    return stableStringify(results);
  }
}
