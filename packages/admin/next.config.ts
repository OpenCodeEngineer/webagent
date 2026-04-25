import type { NextConfig } from "next";

const proxyUrl = process.env.PROXY_URL ?? `http://127.0.0.1:${process.env.PROXY_PORT ?? "3001"}`;

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/agents/create-via-meta",
        destination: `${proxyUrl}/api/agents/create-via-meta`,
      },
      {
        source: "/api/agents/:path*",
        destination: `${proxyUrl}/api/agents/:path*`,
      },
    ];
  },
};

export default nextConfig;
