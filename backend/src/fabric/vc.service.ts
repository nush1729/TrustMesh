import * as crypto from 'crypto';
import { ES256KSigner } from 'did-jwt';
import { createVerifiableCredentialJwt, Issuer, verifyCredential } from 'did-jwt-vc';
import { DIDResolutionResult, Resolver } from 'did-resolver';
import { fabricConfig } from './config';

/**
 * Verifiable Credentials — replaces services/vc.service.ts.
 *
 * §1.3 of the migration proposal notes this file is "largely reusable, pointed
 * at a different resolver", and that is what happened: the issuance and
 * verification logic is unchanged, and only two things moved.
 *
 *   1. Resolver: ethr-did-resolver (which resolves by querying an Ethereum
 *      registry contract, and is meaningless without an EVM chain) is replaced
 *      by key-did-resolver. did:key resolves purely by decoding the identifier
 *      itself, so credential verification no longer depends on any chain being
 *      reachable at all — a verifier can check a credential offline.
 *   2. Issuer DID: did:ethr:amoy:<address> becomes did:key:zQ3s... derived from
 *      the same kind of secp256k1 key, so ES256K signing is unchanged.
 *
 * Credential claims still never contain raw PII — only attestations. Underlying
 * personal data goes to the encrypted Postgres vault (untouched by this
 * migration) and is referenced here at most by a content hash.
 */

/** multicodec secp256k1-pub (0xe7), varint-encoded. */
const SECP256K1_MULTICODEC = Buffer.from([0xe7, 0x01]);
/** multicodec p256-pub (0x1200), varint-encoded. */
const P256_MULTICODEC = Buffer.from([0x80, 0x24]);

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58btcEncode(bytes: Buffer): string {
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (const b of bytes) {
    if (b === 0) out += B58[0];
    else break;
  }
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

function base58btcDecode(value: string): Buffer {
  const bytes: number[] = [0];
  for (const char of value) {
    const index = B58.indexOf(char);
    if (index < 0) throw new Error(`Invalid base58 character '${char}'`);
    let carry = index;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading '1's in base58 encode leading zero bytes.
  let leadingZeros = 0;
  for (const char of value) {
    if (char === B58[0]) leadingZeros++;
    else break;
  }
  return Buffer.from(new Array(leadingZeros).fill(0).concat(bytes.reverse()));
}

/**
 * did:key resolver, implemented here rather than pulled from key-did-resolver.
 *
 * Two reasons, in order:
 *   1. key-did-resolver's transitive `multiformats` is ESM-only and does not
 *      expose the subpaths it imports under CommonJS resolution, so requiring
 *      it crashes this backend at startup. (It survives a bundler-based test
 *      runner, which is exactly the kind of works-in-tests//fails-in-prod gap
 *      worth eliminating rather than working around.)
 *   2. Resolving did:key is genuinely just decoding the identifier — there is
 *      no network call, no registry, no chain. Owning ~30 lines is preferable
 *      to a dependency for something this small, and it makes the "credentials
 *      verify offline" property obvious in the code.
 */
function resolveDidKey(did: string): DIDResolutionResult {
  const notFound = (error: string): DIDResolutionResult => ({
    didResolutionMetadata: { error },
    didDocument: null,
    didDocumentMetadata: {},
  });

  const match = /^did:key:(z[1-9A-HJ-NP-Za-km-z]+)$/.exec(did.split('#')[0]);
  if (!match) return notFound('invalidDid');

  let decoded: Buffer;
  try {
    decoded = base58btcDecode(match[1].slice(1));
  } catch {
    return notFound('invalidDid');
  }

  const prefix = decoded.subarray(0, 2);
  const keyBytes = decoded.subarray(2);

  let type: string;
  let publicKeyHex: string;
  if (prefix.equals(SECP256K1_MULTICODEC)) {
    type = 'EcdsaSecp256k1VerificationKey2019';
    publicKeyHex = keyBytes.toString('hex');
  } else if (prefix.equals(P256_MULTICODEC)) {
    type = 'JsonWebKey2020';
    publicKeyHex = keyBytes.toString('hex');
  } else {
    return notFound('unsupportedKeyType');
  }

  const id = `${did.split('#')[0]}#${match[1]}`;
  const controller = did.split('#')[0];
  return {
    didResolutionMetadata: { contentType: 'application/did+ld+json' },
    didDocument: {
      '@context': ['https://www.w3.org/ns/did/v1'],
      id: controller,
      verificationMethod: [{ id, type, controller, publicKeyHex }],
      authentication: [id],
      assertionMethod: [id],
    },
    didDocumentMetadata: {},
  };
}

const resolver = new Resolver({ key: async (did: string) => resolveDidKey(did) });

/**
 * did:key for the issuer's secp256k1 key.
 *
 * The compressed public key is derived with Node's own ECDH rather than an
 * Ethereum library — this backend has no reason to depend on ethers any more.
 */
export function issuerDidFromPrivateKey(privateKeyHex: string): string {
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(Buffer.from(privateKeyHex.replace(/^0x/, ''), 'hex'));
  const compressed = ecdh.getPublicKey(null, 'compressed'); // 33 bytes
  return 'did:key:z' + base58btcEncode(Buffer.concat([SECP256K1_MULTICODEC, compressed]));
}

function getIssuer(): Issuer {
  const key = fabricConfig.vcIssuerPrivateKey;
  if (!key) {
    throw new Error('VC_ISSUER_PRIVATE_KEY not set — cannot issue Verifiable Credentials.');
  }
  const privateKeyHex = key.replace(/^0x/, '');
  return {
    did: issuerDidFromPrivateKey(privateKeyHex),
    signer: ES256KSigner(Buffer.from(privateKeyHex, 'hex')),
    alg: 'ES256K',
  };
}

export type VcSubject = { id: string; [claim: string]: unknown };

/**
 * Issues a W3C Verifiable Credential JWT for `subjectDid` (a did:key).
 * `claims` are attestations — e.g. { role: "Manager" }, { documentType: "..." } —
 * never raw personal data.
 */
export async function issueCredential(
  subjectDid: string,
  credentialType: string,
  claims: Record<string, unknown>
) {
  const issuer = getIssuer();
  const vcPayload = {
    sub: subjectDid,
    vc: {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', credentialType],
      credentialSubject: { id: subjectDid, ...claims } as VcSubject,
    },
  };
  const jwt = await createVerifiableCredentialJwt(vcPayload, issuer);
  return { jwt, issuerDid: issuer.did };
}

export async function verifyCredentialJwt(jwt: string) {
  // Same cross-package did-resolver version duplication the EVM version
  // documented: did-jwt-vc bundles an older did-resolver whose types do not
  // nominally match the top-level v5 types, while the runtime resolve()
  // contract is identical.
  const result = await verifyCredential(jwt, resolver as unknown as Parameters<typeof verifyCredential>[1]);
  return {
    valid: result.verified,
    issuer: result.issuer,
    subject: result.payload.vc.credentialSubject,
  };
}
