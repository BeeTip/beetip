import type { NextConfig } from "next";

export default function config(): NextConfig {
  const mode = process.env.BEETIP_MODE === "demo" && process.env.VERCEL_ENV !== "production" ? "demo" : "connected";
  return {
    agentRules: false,
    env: { BEETIP_BUILD_MODE: mode },
    pageExtensions: [`${mode}.tsx`, "tsx", "ts", "jsx", "js"],
    transpilePackages: ["@beetip/domain", "@beetip/validation"],
  };
}
