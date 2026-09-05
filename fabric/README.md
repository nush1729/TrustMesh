# TrustMesh — Hyperledger Fabric network

Phase 1 of the Fabric migration (`docs/HYPERLEDGER_FABRIC_MIGRATION_PROPOSAL.md` §6).

## Quick start

```bash
./fabric/install.sh        # one-time: fabric-samples + binaries + docker images
./fabric/network-up.sh     # bring up the 3-org network and verify it
./fabric/verify-network.sh # re-verify an already-running network
./fabric/network-down.sh   # tear down
```

`install.sh` and `network-up.sh` both require the Docker daemon to be running.

## Topology

The official `fabric-samples` **test-network**, extended to **three organizations**
using the samples' own `addOrg3` script — per §5 decision 3 and §9's warning that
hand-rolled Fabric config is where teams lose time.

Three orgs, not the default two, because the §3 governance design maps each named
2-of-3 governance signer onto a **separate organization** running its own peer:

| Fabric org | TrustMesh role | Peer | CouchDB | CA |
|---|---|---|---|---|
| `Org1MSP` | IssuingDept | `localhost:7051` | `localhost:5984` | `localhost:7054` |
| `Org2MSP` | AuditOrg | `localhost:9051` | `localhost:7984` | `localhost:8054` |
| `Org3MSP` | IndependentVerifier | `localhost:11051` | `localhost:9984` | `localhost:11054` |

Orderer: `localhost:7050` (`orderer.example.com`). Channel: **`trustmesh`**.

This is a materially stronger threat model than the EVM design's Gnosis Safe:
compromising a signer now means compromising an entire organization's peer
infrastructure, not just a laptop holding a private key.

## Versions

Fabric **2.5.16**, Fabric CA **1.5.17**. Binaries are native `darwin/arm64`.

## Design notes

**CouchDB from the start, not retrofitted.** Both `network-up.sh` and `addOrg3`
are invoked with `-s couchdb`. Fabric's default LevelDB state database has no
rich-query support, and the chaincode needs exactly that ("all assets owned by
X", "all roles held by a DID"). Switching later would mean re-bootstrapping every
peer's state, so it is set on the first bring-up. See §9, "Rich lookups".

**Bring-up sequencing.** §9 lists network bring-up as Fabric's flakiest step.
`network-up.sh` addresses this by polling each peer's ledger until it genuinely
answers on the channel before moving to the next stage, rather than sleeping a
fixed interval, and by ending in a hard verification gate. `network-down.sh`
tears down `addOrg3` first because `network.sh down` does not know about
`peer0.org3` or `couchdb4`.

**Where the network lives.** `fabric-samples` is deliberately *not* vendored into
this repository — it is a large third-party checkout with its own release cadence.
`fabric/network-env.sh` is the single place that knows its location; override with
`FABRIC_SAMPLES=/some/path` if you keep it elsewhere. Default: `~/fabric/fabric-samples`.

## Verification

`verify-network.sh` asserts (exits non-zero on failure) the Phase 1 completion
criteria — 11 containers running, MSP material present and parseable as real
X.509 for all 3 orgs plus the orderer org, all 3 peers on the channel *at the
same ledger height*, orderer reachable, all 4 CAs answering `/cainfo`, and all
3 CouchDB instances responding. 30 checks.
