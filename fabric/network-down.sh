#!/usr/bin/env bash
# TrustMesh — tear the Fabric network down, including Org3 and CouchDB volumes.
#
#   ./fabric/network-down.sh

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
source fabric/network-env.sh

[ -d "$TEST_NETWORK" ] || { echo "fabric-samples not found at $FABRIC_SAMPLES — nothing to tear down."; exit 0; }

cd "$TEST_NETWORK"
# addOrg3's teardown must run first: it owns peer0.org3 and couchdb4, which
# network.sh down does not know about.
(cd addOrg3 && ./addOrg3.sh down) >/dev/null 2>&1 || true
./network.sh down

echo "Network down."
