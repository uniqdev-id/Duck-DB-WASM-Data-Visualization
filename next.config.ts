import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure DuckDB WASM is never bundled on the server side.
  // (AGENTS.md rule 1: client-side only)
  serverExternalPackages: ["@duckdb/duckdb-wasm"],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp",
          },
        ],
      },
    ];
  },

  // Turbopack config (used by `next dev` in Next.js 16 — the default bundler).
  // An empty object suppresses the "webpack config with no turbopack config" error.
  // DuckDB WASM bundles are fetched from jsDelivr CDN at runtime via importScripts,
  // so no special Turbopack loader rule is needed for the WASM binary itself.
  turbopack: {},

  // Webpack config — still used by `next build`.
  webpack(config, { isServer }) {
    if (!isServer) {
      // Required for DuckDB WASM's WebAssembly modules during production builds.
      config.experiments = {
        ...config.experiments,
        asyncWebAssembly: true,
        layers: true,
      };
    }
    return config;
  },
};

export default nextConfig;
