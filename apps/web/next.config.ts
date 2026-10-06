import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@beetip/domain", "@beetip/validation"],
};

export default config;
