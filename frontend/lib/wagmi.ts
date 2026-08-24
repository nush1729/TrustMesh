import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain } from "viem";

export const polygonAmoy = defineChain({
  id: 80002,
  name: "Polygon Amoy",
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_AMOY_RPC_URL || "https://rpc-amoy.polygon.technology"] },
  },
  blockExplorers: {
    default: { name: "PolygonScan Amoy", url: "https://amoy.polygonscan.com" },
  },
  testnet: true,
});

// Local demo chain: a plain Hardhat node has no faucet gate, so this is what
// the live judge demo actually runs against instead of Amoy.
export const hardhatLocal = defineChain({
  id: 31337,
  name: "Hardhat Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_AMOY_RPC_URL || "http://127.0.0.1:8545"] },
  },
  testnet: true,
});

const demoChain = process.env.NEXT_PUBLIC_CHAIN_ID === "31337" ? hardhatLocal : polygonAmoy;

export const wagmiConfig = getDefaultConfig({
  appName: "TrustMesh",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "trustmesh-dev",
  chains: [demoChain],
  ssr: true,
});
