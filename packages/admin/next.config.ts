import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/agents/create-via-meta",
        destination: "http://localhost:3001/api/agents/create-via-meta",
      },
      {
        source: "/api/agents/:path*",
        destination: "http://localhost:3001/api/agents/:path*",
      },
    ];
  },
};

export default nextConfig;
