#!/usr/bin/env bash
# TrustMesh — package, install, approve and commit the chaincode.
#
#   ./fabric/deploy-chaincode.sh [single|multi]
#
#     single  endorsement policy OR('Org1MSP.peer')                       -- one org suffices
#     multi   endorsement policy OutOf(2,'Org1MSP.peer','Org2MSP.peer','Org3MSP.peer')
#             (default) -- the §3 platform layer: two organizations' peers must
#             independently endorse every write, including writes to the
#             governance approval state itself
#
# §9 advises building the propose/approve/execute chaincode against a trivial
# single-org policy first and only then adding the multi-org policy as a second
# pass, which is why both are selectable here rather than the multi-org policy
# being hardcoded.
#
# The sequence number is derived from what is already committed, so re-running
# this to upgrade the chaincode just works.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO_ROOT="$PWD"
source fabric/network-env.sh

MODE="${1:-multi}"
case "$MODE" in
  single) POLICY="OR('Org1MSP.peer')" ;;
  multi)  POLICY="OutOf(2,'Org1MSP.peer','Org2MSP.peer','Org3MSP.peer')" ;;
  *) echo "usage: $0 [single|multi]" >&2; exit 1 ;;
esac

CC_SRC="$REPO_ROOT/chaincode/trustmesh"
CC_LABEL="${CHAINCODE_NAME}"

echo "==> Building chaincode TypeScript"
(cd "$CC_SRC" && npm run --silent build)

# Stage a clean copy: peer packaging tars the whole --path directory, and we do
# not want the local node_modules (built for darwin/arm64) shipped to the
# fabric-nodeenv container, which installs its own.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/src"
cp "$CC_SRC/package.json" "$STAGE/"
cp -R "$CC_SRC/dist" "$STAGE/dist"

echo "==> Packaging"
PKG="$STAGE/${CC_LABEL}.tar.gz"
setOrg 1
peer lifecycle chaincode package "$PKG" \
  --path "$STAGE" --lang node --label "${CC_LABEL}_1"

# Determine the next sequence from what is already committed on the channel.
SEQ=1
if committed=$(peer lifecycle chaincode querycommitted -C "$CHANNEL_NAME" -n "$CHAINCODE_NAME" 2>/dev/null); then
  cur=$(echo "$committed" | sed -n 's/.*Sequence: \([0-9]*\).*/\1/p' | head -1)
  [ -n "$cur" ] && SEQ=$((cur + 1))
fi
echo "==> Deploying '$CHAINCODE_NAME' sequence $SEQ"
echo "    endorsement policy: $POLICY"

echo "==> Installing on all 3 peers"
for o in 1 2 3; do
  setOrg "$o"
  # Re-installing an identical package is not an error worth stopping for.
  peer lifecycle chaincode install "$PKG" >/dev/null 2>&1 || true
  echo "    installed on Org$o"
done

setOrg 1
PACKAGE_ID=$(peer lifecycle chaincode queryinstalled 2>/dev/null \
  | sed -n "s/^Package ID: \(${CC_LABEL}_1:[a-f0-9]*\), Label: .*/\1/p" | tail -1)
[ -n "$PACKAGE_ID" ] || { echo "could not determine package id" >&2; exit 1; }
echo "    package id: $PACKAGE_ID"

echo "==> Approving for all 3 organizations"
for o in 1 2 3; do
  setOrg "$o"
  peer lifecycle chaincode approveformyorg \
    -o "$ORDERER_ADDRESS" --ordererTLSHostnameOverride "$ORDERER_HOSTNAME" --tls --cafile "$ORDERER_CA" \
    --channelID "$CHANNEL_NAME" --name "$CHAINCODE_NAME" --version "$SEQ" --package-id "$PACKAGE_ID" \
    --sequence "$SEQ" --signature-policy "$POLICY" >/dev/null
  echo "    approved by Org$o"
done

echo "==> Checking commit readiness"
setOrg 1
peer lifecycle chaincode checkcommitreadiness \
  --channelID "$CHANNEL_NAME" --name "$CHAINCODE_NAME" --version "$SEQ" --sequence "$SEQ" \
  --signature-policy "$POLICY" --output json

echo "==> Committing"
peer lifecycle chaincode commit \
  -o "$ORDERER_ADDRESS" --ordererTLSHostnameOverride "$ORDERER_HOSTNAME" --tls --cafile "$ORDERER_CA" \
  --channelID "$CHANNEL_NAME" --name "$CHAINCODE_NAME" --version "$SEQ" --sequence "$SEQ" \
  --signature-policy "$POLICY" \
  --peerAddresses "$PEER0_ORG1_ADDRESS" --tlsRootCertFiles "$PEER0_ORG1_CA" \
  --peerAddresses "$PEER0_ORG2_ADDRESS" --tlsRootCertFiles "$PEER0_ORG2_CA" \
  --peerAddresses "$PEER0_ORG3_ADDRESS" --tlsRootCertFiles "$PEER0_ORG3_CA"

echo "==> Committed definition"
peer lifecycle chaincode querycommitted -C "$CHANNEL_NAME" -n "$CHAINCODE_NAME"

echo
echo "Chaincode '$CHAINCODE_NAME' deployed (sequence $SEQ, $MODE-org endorsement policy)."
