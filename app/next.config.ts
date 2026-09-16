import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  devIndicators: false,
  // Next.js's own AGENTS.md/CLAUDE.md scaffolding is out of scope for this task.
  agentRules: false,
};

export default nextConfig;
