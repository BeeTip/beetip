import next from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  ...next,
  ...typescript,
  { settings: { react: { version: "19.3" }, next: { rootDir: "apps/web/" } } },
  { ignores: ["**/.next/**", "**/next-env.d.ts", "playwright-report/**", "test-results/**"] },
];
export default config;
