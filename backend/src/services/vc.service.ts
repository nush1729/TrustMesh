import { ES256KSigner } from "did-jwt";
import { createVerifiableCredentialJwt, verifyCredential, Issuer } from "did-jwt-vc";
import { Resolver } from "did-resolver";
import { getResolver } from "ethr-did-resolver";
import { ethers } from "ethers";
import { config } from "../config";

const ethrResolver = getResolver({
  networks: [{ name: "amoy", chainId: 80002, rpcUrl: config.amoyRpcUrl }],
});
const resolver = new Resolver(ethrResolver);

function getIssuer(): Issuer {
  if (!config.chainPrivateKey) {
    throw new Error("CHAIN_PRIVATE_KEY not set — cannot issue Verifiable Credentials.");
  }
  const wallet = new ethers.Wallet(config.chainPrivateKey);
  const issuerDid = `did:ethr:amoy:${wallet.address}`;
  const privateKeyHex = config.chainPrivateKey.replace(/^0x/, "");
  return {
    did: issuerDid,
    signer: ES256KSigner(Buffer.from(privateKeyHex, "hex")),
    alg: "ES256K",
  };
}

export type VcSubject = { id: string; [claim: string]: unknown };

/// Issues a W3C Verifiable Credential JWT for `subjectDid`. `claims` are the
/// attributes being attested (e.g. { role: "Manager", documentType: "UG
/// Marksheet" }) — never raw PII values; those go through vault.service.ts
/// instead and are referenced here only by a contentHash if needed.
export async function issueCredential(subjectDid: string, credentialType: string, claims: Record<string, unknown>) {
  const issuer = getIssuer();
  const vcPayload = {
    sub: subjectDid,
    vc: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiableCredential", credentialType],
      credentialSubject: { id: subjectDid, ...claims } as VcSubject,
    },
  };
  const jwt = await createVerifiableCredentialJwt(vcPayload, issuer);
  return { jwt, issuerDid: issuer.did };
}

export async function verifyCredentialJwt(jwt: string) {
  // did-jwt-vc bundles its own (older) did-resolver types internally, which
  // don't nominally match the top-level did-resolver v5 types used to build
  // `resolver` above — a known cross-package version duplication in this
  // ecosystem (did-jwt-vc hasn't updated its did-resolver dependency yet).
  // The runtime `resolve()` contract is unchanged between the two, so this
  // cast is safe; the alternative is pinning did-resolver back to v4 and
  // losing ethr-did-resolver's expected version instead.
  const result = await verifyCredential(jwt, resolver as unknown as Parameters<typeof verifyCredential>[1]);
  return {
    valid: result.verified,
    issuer: result.issuer,
    subject: result.payload.vc.credentialSubject,
  };
}
