import next from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  ...next,
  ...typescript,
  { settings: { react: { version: "19.3" }, next: { rootDir: "apps/web/" } } },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    ignores: [
      "apps/web/src/app/api/jobs/transactional-email/route.ts",
      "apps/web/src/app/api/webhooks/brevo/route.ts",
    ],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["**/job-client", "**/job-client.*"] }],
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    ignores: ["apps/web/src/server/email/job-client.ts"],
    rules: {
      "no-restricted-syntax": ["error", {
        selector: "MemberExpression[property.name='BEETIP_EMAIL_SUPABASE_SECRET_KEY'], MemberExpression[property.value='BEETIP_EMAIL_SUPABASE_SECRET_KEY'], ObjectPattern > Property[key.name='BEETIP_EMAIL_SUPABASE_SECRET_KEY']",
        message: "Read the email database credential only in the server-only job client.",
      }],
    },
  },
  { ignores: ["**/.next/**", "**/next-env.d.ts", "playwright-report/**", "test-results/**"] },
];
export default config;
