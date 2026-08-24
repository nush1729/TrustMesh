import type { NextConfig } from "next";

// RainbowKit -> wagmi -> @coinbase/cdp-sdk pulls in optional x402 payment
// modules that are not installed and are unrelated to plain wallet-connect
// usage. Stub them out so webpack doesn't fail trying to resolve them.
const UNUSED_X402_MODULES = [
  "@x402/evm/upto/client",
  "@x402/evm/exact/client",
  "@x402/core/client",
  "@x402/svm/exact/client",
  "@x402/evm",
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      ...Object.fromEntries(UNUSED_X402_MODULES.map((m) => [m, false])),
    };
    return config;
  },
};

export default nextConfig;
