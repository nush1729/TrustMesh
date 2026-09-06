#!/usr/bin/env bash
# TrustMesh — shared Fabric environment.
#
# Source this (do not execute it) before running any peer/configtxgen command:
#   source fabric/network-env.sh
#
# Everything downstream (bring-up, chaincode deploy, verification, the backend's
# Gateway config) reads its paths from here so there is exactly one place that
# knows where the network lives.

# Location of the official fabric-samples checkout (installed by fabric/install.sh).
# Override with FABRIC_SAMPLES=/some/path if you keep it elsewhere.
export FABRIC_SAMPLES="${FABRIC_SAMPLES:-$HOME/fabric/fabric-samples}"
export TEST_NETWORK="$FABRIC_SAMPLES/test-network"

# Fabric binaries (peer, configtxgen, ...) and Docker's CLI.
export PATH="$FABRIC_SAMPLES/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
export FABRIC_CFG_PATH="$FABRIC_SAMPLES/config"

# --- TrustMesh network identifiers -------------------------------------------
export CHANNEL_NAME="${CHANNEL_NAME:-trustmesh}"
export CHAINCODE_NAME="${CHAINCODE_NAME:-trustmesh}"

# The three organizations map 1:1 onto the three named governance signers from
# the migration proposal's §3. Org1/2/3 are the test-network's names; the
# TrustMesh-facing role of each is:
#   Org1MSP -> IssuingDept          (proposes; operational tier)
#   Org2MSP -> AuditOrg             (approver)
#   Org3MSP -> IndependentVerifier  (approver)
export ORG1_ROLE="IssuingDept"
export ORG2_ROLE="AuditOrg"
export ORG3_ROLE="IndependentVerifier"

export ORDERER_CA="$TEST_NETWORK/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem"
export ORDERER_ADDRESS="localhost:7050"
export ORDERER_HOSTNAME="orderer.example.com"

export PEER0_ORG1_CA="$TEST_NETWORK/organizations/peerOrganizations/org1.example.com/tlsca/tlsca.org1.example.com-cert.pem"
export PEER0_ORG2_CA="$TEST_NETWORK/organizations/peerOrganizations/org2.example.com/tlsca/tlsca.org2.example.com-cert.pem"
export PEER0_ORG3_CA="$TEST_NETWORK/organizations/peerOrganizations/org3.example.com/tlsca/tlsca.org3.example.com-cert.pem"

export PEER0_ORG1_ADDRESS="localhost:7051"
export PEER0_ORG2_ADDRESS="localhost:9051"
export PEER0_ORG3_ADDRESS="localhost:11051"

# setOrg <1|2|3> — point the peer CLI at that organization's admin identity.
setOrg() {
  local n="$1"
  export CORE_PEER_TLS_ENABLED=true
  case "$n" in
    1)
      export CORE_PEER_LOCALMSPID="Org1MSP"
      export CORE_PEER_TLS_ROOTCERT_FILE="$PEER0_ORG1_CA"
      export CORE_PEER_MSPCONFIGPATH="$TEST_NETWORK/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp"
      export CORE_PEER_ADDRESS="$PEER0_ORG1_ADDRESS"
      ;;
    2)
      export CORE_PEER_LOCALMSPID="Org2MSP"
      export CORE_PEER_TLS_ROOTCERT_FILE="$PEER0_ORG2_CA"
      export CORE_PEER_MSPCONFIGPATH="$TEST_NETWORK/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp"
      export CORE_PEER_ADDRESS="$PEER0_ORG2_ADDRESS"
      ;;
    3)
      export CORE_PEER_LOCALMSPID="Org3MSP"
      export CORE_PEER_TLS_ROOTCERT_FILE="$PEER0_ORG3_CA"
      export CORE_PEER_MSPCONFIGPATH="$TEST_NETWORK/organizations/peerOrganizations/org3.example.com/users/Admin@org3.example.com/msp"
      export CORE_PEER_ADDRESS="$PEER0_ORG3_ADDRESS"
      ;;
    *)
      echo "setOrg: expected 1, 2 or 3 (got '$n')" >&2
      return 1
      ;;
  esac
}
