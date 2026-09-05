import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import * as registry from './registry';
import { AssetRecord, DOC_TYPE } from './types';
import { requireArg, stableStringify } from './util';

/**
 * AssetNFT — replaces AssetNFT.sol.
 *
 * Digital assets, permanently and verifiably linked to an identity. Each asset
 * carries an owner (a DID hash), a storage pointer into the private Kubo store
 * and a content hash proving integrity — and nothing else.
 *
 * ASSET-TYPE-AGNOSTIC BY RULE. PS 26125 asks for generic NFT-represented
 * digital assets. No field here describes what kind of thing an asset is, and
 * none may be added: land records and similar are illustrative pitch examples,
 * never build requirements (migration proposal scope note).
 *
 * Reads only. mintAsset and transferAsset are privileged and run solely through
 * Governance.ExecuteProposal. As on EVM there is deliberately no open,
 * holder-callable transfer: custody changes are institutional decisions
 * requiring the same sign-off as the original allocation (Final Solution §3
 * Step 6), not peer-to-peer trades.
 */
@Info({ title: 'AssetNFT', description: 'Digital assets bound to identities, with governed custody' })
export class AssetNFTContract extends Contract {
  constructor() {
    super('AssetNFT');
  }

  /** Mirrors AssetNFT.getAssetOwner() / ownerOf(). */
  @Transaction(false)
  @Returns('string')
  public async GetAssetOwner(ctx: Context, assetId: string): Promise<string> {
    const record = await registry.readAsset(ctx, requireArg('assetId', assetId));
    if (!record) throw new Error('AssetNFT: unknown asset');
    return record.owner;
  }

  /** Mirrors AssetNFT.assetMeta() plus ownership, as one record. */
  @Transaction(false)
  @Returns('string')
  public async GetAsset(ctx: Context, assetId: string): Promise<string> {
    const record = await registry.readAsset(ctx, requireArg('assetId', assetId));
    if (!record) throw new Error('AssetNFT: unknown asset');
    return stableStringify(record);
  }

  @Transaction(false)
  @Returns('boolean')
  public async AssetExists(ctx: Context, assetId: string): Promise<boolean> {
    return (await registry.readAsset(ctx, requireArg('assetId', assetId))) !== null;
  }

  /**
   * All assets owned by one identity — the exact "all assets owned by X" lookup
   * the migration proposal's §9 names as the reason CouchDB, not LevelDB, must
   * be the state database. On LevelDB this query cannot be answered at all.
   */
  @Transaction(false)
  @Returns('string')
  public async QueryAssetsByOwner(ctx: Context, owner: string): Promise<string> {
    const query = { selector: { docType: DOC_TYPE.ASSET, owner: requireArg('owner', owner) } };
    const iterator = await ctx.stub.getQueryResult(JSON.stringify(query));
    const results: AssetRecord[] = [];
    for (let res = await iterator.next(); !res.done; res = await iterator.next()) {
      results.push(JSON.parse(res.value.value.toString()) as AssetRecord);
    }
    await iterator.close();
    results.sort((a, b) => (a.mintedAt < b.mintedAt ? 1 : -1));
    return stableStringify(results);
  }

  /**
   * An asset's full custody history, straight from the ledger's immutable key
   * history — the tamper-proof provenance trail the problem statement asks for.
   */
  @Transaction(false)
  @Returns('string')
  public async GetAssetHistory(ctx: Context, assetId: string): Promise<string> {
    const key = ctx.stub.createCompositeKey('asset', [requireArg('assetId', assetId)]);
    const iterator = await ctx.stub.getHistoryForKey(key);
    const history: Array<Record<string, unknown>> = [];
    for (let res = await iterator.next(); !res.done; res = await iterator.next()) {
      const seconds = res.value.timestamp?.seconds;
      const millis = seconds ? Number(seconds.toString()) * 1000 : 0;
      history.push({
        txId: res.value.txId,
        timestamp: new Date(millis).toISOString(),
        isDelete: res.value.isDelete,
        value: res.value.value?.length ? JSON.parse(res.value.value.toString()) : null,
      });
    }
    await iterator.close();
    return stableStringify(history);
  }
}
