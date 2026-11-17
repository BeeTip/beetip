import type { NextConfig } from "next";

const config: NextConfig = {
  agentRules: false,
  transpilePackages: ["@beetip/domain", "@beetip/validation"],
};

export default config;
