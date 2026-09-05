import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import * as registry from './registry';
import { requireArg, sha256Hex, stableStringify, verifyPossession } from './util';

/**
 * DIDRegistry — replaces DIDRegistry.sol.
 *
 * Anchors the controller key for a decentralized identifier. Stores ONLY the
 * DID, its hash and the current controlling public key — no names, documents
 * or other personal data ever reach this registry (Final Solution §6).
 *
 * DID method is did:key (§5 decision 1): the identifier IS the key material,
 * so no separate resolution infrastructure is needed, and the ledger anchors
 * only the hash and current status.
 *
 * updateController lives in the Governance contract, not here — re-binding an
 * identity to a new key is a privileged, multi-party-approved act.
 */
@Info({ title: 'DIDRegistry', description: 'Identity anchors — DID hash to controlling public key' })
export class DIDRegistryContract extends Contract {
  constructor() {
    super('DIDRegistry');
  }

  /**
   * Self-registration. Mirrors DIDRegistry.registerDID().
   *
   * NOT governed, deliberately: on EVM anyone could register their own DID
   * without an admin's permission, and the Final Solution (§3 Step 1) calls
   * that out as the point — "identity creation is self-sovereign from the first
   * transaction, not something an admin grants". Keeping it ungoverned
   * preserves that.
   *
   * What replaces EVM's `msg.sender` binding is `signatureB64`: a signature
   * over the DID string, made with the private key matching
   * `controllerPublicKeyB64`. Under §4's decided design the backend submits
   * this transaction on the citizen's behalf, so without proof of possession a
   * compromised backend could register a citizen's DID against a key the
   * backend controls. Verifying it here means the ledger will not record a
   * controller key the requester cannot prove they hold — the self-sovereign
   * property survives the move to a backend-submitted transaction.
   *
   * @param did did:key identifier
   * @param controllerPublicKeyB64 base64 SPKI DER of an ECDSA P-256 public key
   * @param signatureB64 base64 raw r||s signature over `did`
   */
  @Transaction()
  @Returns('string')
  public async RegisterDID(
    ctx: Context,
    did: string,
    controllerPublicKeyB64: string,
    signatureB64: string
  ): Promise<string> {
    requireArg('did', did);
    requireArg('controllerPublicKeyB64', controllerPublicKeyB64);
    requireArg('signatureB64', signatureB64);

    if (!did.startsWith('did:key:')) {
      throw new Error('DIDRegistry: did must be a did:key identifier');
    }
    if (!verifyPossession(controllerPublicKeyB64, did, signatureB64)) {
      throw new Error('DIDRegistry: proof of possession failed — signature does not match public key');
    }

    const didHash = sha256Hex(did);
    const event = await registry.registerDid(ctx, didHash, did, controllerPublicKeyB64);
    ctx.stub.setEvent(event.name, Buffer.from(stableStringify(event.payload)));
    return stableStringify({ didHash, did, controller: controllerPublicKeyB64 });
  }

  /** Mirrors DIDRegistry.getController(). */
  @Transaction(false)
  @Returns('string')
  public async GetController(ctx: Context, didHash: string): Promise<string> {
    const record = await registry.readDid(ctx, requireArg('didHash', didHash));
    if (!record) throw new Error('DIDRegistry: unknown DID');
    return record.controllerPublicKey;
  }

  /** Mirrors DIDRegistry.exists(). */
  @Transaction(false)
  @Returns('boolean')
  public async DIDExists(ctx: Context, didHash: string): Promise<boolean> {
    return (await registry.readDid(ctx, requireArg('didHash', didHash))) !== null;
  }

  /** Full record — what the backend's signed-challenge login reads to get the public key. */
  @Transaction(false)
  @Returns('string')
  public async GetDID(ctx: Context, didHash: string): Promise<string> {
    const record = await registry.readDid(ctx, requireArg('didHash', didHash));
    if (!record) throw new Error('DIDRegistry: unknown DID');
    return stableStringify(record);
  }
}
