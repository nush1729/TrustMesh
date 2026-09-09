# Environment Setup — TrustMesh (Hyperledger Fabric stack)

Everything below is **self-hosted and free** — no external accounts, API
keys, or testnet faucets are needed for the Fabric stack. That is a
deliberate design property, not an oversight: see
`docs/HYPERLEDGER_FABRIC_MIGRATION_PROPOSAL.md` §5. If a step below ever
seems to need a paid service or an external account, that means the design
has drifted — stop and re-check against the migration proposal rather than
signing up for something.

The original Polygon Amoy / Gnosis Safe / WalletConnect setup still applies
to the EVM fallback stack and is preserved at the bottom of this document.

---

## 1. Docker

Needed for the Fabric network (peers, orderer, CAs, CouchDB all run as
containers).

```bash
# Docker Desktop, from docker.com — no account required to run it locally.
/Applications/Docker.app/Contents/Resources/bin/docker ps   # verify it's running
```

## 2. Hyperledger Fabric network

One-time install, then bring the network up:

```bash
./fabric/install.sh        # fabric-samples + native binaries + docker images (no signup)
./fabric/network-up.sh     # brings up the 3-org network, joins the channel, verifies it
```

This creates a **3-organization** Fabric test-network (extended from the
official 2-org sample via its own `addOrg3` script):

| Fabric org | TrustMesh role | Peer | CouchDB | CA |
|---|---|---|---|---|
| `Org1MSP` | IssuingDept | `localhost:7051` | `localhost:5984` | `localhost:7054` |
| `Org2MSP` | AuditOrg | `localhost:9051` | `localhost:7984` | `localhost:8054` |
| `Org3MSP` | IndependentVerifier | `localhost:11051` | `localhost:9984` | `localhost:11054` |

Orderer at `localhost:7050`, channel `trustmesh`. All MSP/TLS material is
generated locally by `cryptogen`/`fabric-ca-client` — nothing to request from
anyone.

Re-verify an already-running network at any time (idempotent, asserts rather
than prints — exits non-zero on the first real failure):

```bash
./fabric/verify-network.sh
```

Tear down when done:

```bash
./fabric/network-down.sh
```

## 3. Chaincode (TrustMesh governance + registries)

```bash
./fabric/deploy-chaincode.sh    # packages, installs, approves, commits trustmesh chaincode on all 3 orgs
./fabric/verify-chaincode.sh    # runs 40+ real invoke/query checks, incl. negative endorsement-policy tests
```

## 4. PostgreSQL (`DATABASE_URL`) — unchanged from the EVM setup

Local, free, no signup:

```bash
brew install postgresql@16      # macOS; use your distro's package manager elsewhere
brew services start postgresql@16
createdb trustmesh
```

`backend/.env` → `DATABASE_URL=postgres://localhost:5432/trustmesh`. Then apply the schema:

```bash
cd backend
npm install
npm run migrate
```

(Hosted free-tier alternative: [neon.tech](https://neon.tech) or [supabase.com](https://supabase.com).)

## 5. Kubo (`IPFS_API_URL`) — private IPFS uploads, unchanged from Stage 1 P3.1

No signup, no API key:

```bash
brew install ipfs      # macOS; see ipfs.tech/install for other platforms
ipfs init
ipfs daemon             # leave running — API on :5001, gateway on :8080
```

`backend/.env` → `IPFS_API_URL=http://127.0.0.1:5001` (already the default if unset).

## 6. Keys and secrets — generate locally, nothing to sign up for

```bash
openssl rand -hex 32   # VC_ISSUER_PRIVATE_KEY  — secp256k1 key backing the issuer did:key
openssl rand -hex 32   # PII_VAULT_MASTER_KEY    — losing this = erasing every vault entry (the intended DPDP mechanism)
openssl rand -hex 32   # SESSION_SECRET
```

## 7. `backend/.env` — Fabric variables

Copy `backend/.env.fabric.example` to `backend/.env` and fill in:

```
PORT=4000
FRONTEND_ORIGIN=http://localhost:3000
DATABASE_URL=postgres://localhost:5432/trustmesh

FABRIC_TEST_NETWORK_PATH=/absolute/path/to/fabric-samples/test-network
FABRIC_CHANNEL_NAME=trustmesh
FABRIC_CHAINCODE_NAME=trustmesh
FABRIC_PRIMARY_ORG=org1
FABRIC_CHECKPOINT_FILE=./.fabric-checkpoint.json

IPFS_API_URL=http://127.0.0.1:5001

VC_ISSUER_PRIVATE_KEY=<from step 6>
PII_VAULT_MASTER_KEY=<from step 6>
SESSION_SECRET=<from step 6>
```

Every EVM variable (`AMOY_RPC_URL`, `CHAIN_ID`, `CHAIN_PRIVATE_KEY`,
`GNOSIS_SAFE_ADDRESS`, `SAFE_LOCAL_MODE`, `LOCAL_SAFE_OWNER*_KEY`,
`PINATA_JWT`, the `*_ADDRESS` contract addresses) is obsolete on this stack —
they belong only in the EVM fallback's config, not here.

## 8. DigiLocker (explicitly NOT required for this prototype)

Unchanged — the onboarding flow uses a static mock
(`backend/src/services/digilocker.mock.ts`).

---

## Full local run order (Fabric stack)

```bash
# 1. Network + chaincode
./fabric/install.sh
./fabric/network-up.sh
./fabric/deploy-chaincode.sh
./fabric/verify-network.sh && ./fabric/verify-chaincode.sh

# 2. Postgres + Kubo
createdb trustmesh
ipfs daemon &     # leave running

# 3. Backend
cd backend
cp .env.fabric.example .env   # fill in per step 6/7 above
npm install
npm run migrate
npm run dev:fabric             # http://localhost:4000 — server.fabric.ts

# 4. Frontend
cd ../frontend
npm install
npm run dev                    # http://localhost:3000
```

Frontend needs no `.env.local` entries for the identity flow itself — the
citizen keypair is generated entirely client-side (`frontend/lib/identity.ts`,
WebCrypto). Only `NEXT_PUBLIC_BACKEND_URL` need be set if the backend isn't at
the default `http://localhost:4000`.

---

## Bootstrapping org-affiliated admins for local dev (V1 governance fix)

`POST /governance/approve` derives the approving organization from the
caller's **own** session — looked up server-side in the `org_admins` table —
instead of a client-supplied `org` field (security audit V1: this used to let
one Admin session satisfy the whole 2-of-3 quorum alone). That means driving
a real 2-of-3 governance approval locally now genuinely requires **two
different logged-in identities**, each affiliated with a different
organization — one browser tab/session can no longer stand in for all three.

An identity only gets an org affiliation via `fabric/bootstrap.ts` (the same
out-of-band genesis tool that already grants the first Admin role — never via
an HTTP route, so a compromised Admin session can't self-assign a second
affiliation):

```bash
cd backend
npx tsx src/fabric/bootstrap.ts <64-char didHash> Admin 365 org1
npx tsx src/fabric/bootstrap.ts <64-char didHash> Admin 365 org2
npx tsx src/fabric/bootstrap.ts <64-char didHash> Admin 365 org3
```

For local dev/testing, `fabric/tools/bootstrap-org-admins.sh` automates the
whole thing — generating three real did:key identities, registering each on
the ledger, and bootstrapping each as the Admin representative of a different
organization, in one step:

```bash
# with the Fabric network + chaincode up and `npm run dev:fabric` running:
./fabric/tools/bootstrap-org-admins.sh
# or, if the backend isn't at the default http://localhost:4000:
./fabric/tools/bootstrap-org-admins.sh http://localhost:PORT
```

Requires `jq`. Each generated identity (did, didHash, public key, **and
private key** — needed to actually sign a login challenge and act as that
identity) is saved to `fabric/tools/generated/{org1,org2,org3}-admin.json`.
That directory is gitignored: these are throwaway local identities, never
anything to commit.

To exercise the real flow end-to-end: log in as the `org1` identity (sign a
`POST /auth/challenge` nonce with its `privateKeyPem`, same as the
`loginAs()` test helper does), propose or grant something, then log in as the
`org2` identity in a second session and call `POST /governance/approve`
there — that is now the only way to reach quorum.

---

## Appendix: EVM fallback stack setup (Polygon Amoy)

Preserved from before the migration — needed only if you're running
`backend/src/server.ts` / the EVM frontend path rather than the Fabric stack
above.

### A1. Polygon Amoy RPC URL (`AMOY_RPC_URL`)
1. Go to [alchemy.com](https://alchemy.com) → sign up free → **Create App**.
2. Chain: **Polygon**, Network: **Polygon Amoy**.
3. Copy the HTTPS URL from the app dashboard.
4. (Alternative) [infura.io](https://infura.io) free tier, or the public
   `https://rpc-amoy.polygon.technology` for light testing (rate-limited).

### A2. Deployer & Backend Relayer Wallets
Two separate throwaway wallets (never a personal wallet key).
`contracts/.env` → `DEPLOYER_PRIVATE_KEY`; `backend/.env` → `CHAIN_PRIVATE_KEY`.
Fund the deployer with test POL: [Polygon Faucet](https://faucet.polygon.technology/).

### A3. Gnosis Safe (Multi-Sig) on Amoy
[app.safe.global](https://app.safe.global) → create a 2-of-3 Safe on Polygon
Amoy → fund it with test POL → `GNOSIS_SAFE_ADDRESS` in `contracts/.env` and `backend/.env`.

### A4. Deploy Contracts & Wire the Safe
```bash
cd contracts
cp .env.example .env
npm install
npm run compile
npm run deploy:amoy
BACKEND_RELAYER_ADDRESS=0x... npm run configure:amoy
```

### A5. WalletConnect Project ID
[cloud.walletconnect.com](https://cloud.walletconnect.com) → Create Project →
`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` in `frontend/.env.local`.

Postgres, Kubo, `PII_VAULT_MASTER_KEY`, and `SESSION_SECRET` are shared with
the Fabric setup above — no need to redo those.
