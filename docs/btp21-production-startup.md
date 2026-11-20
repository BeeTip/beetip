# BTP-21 connected production startup

The release browser suite starts the compiled Next.js app on loopback in connected production mode with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `APP_ORIGIN` empty. It uses Chromium and synthetic demo browser state. It requires no database, account, or hosted service.

- The guest board and listing detail surface the catalog API's `503 UNAVAILABLE` with private, non-cacheable responses and no demo listings. Login, signup, account, and listing creation display the unavailable state without usable forms.
- Stale demo administrator state in browser storage grants no controls. Direct demo-only routes redirect to `/account`, seeded order and chat URLs show unavailable states, and staff reads and role changes return `503 UNAVAILABLE`.

CI builds the candidate after the demo browser suite, then starts that build for the release checks. Run these commands from a shell with Node 24.22.1 and the locked dependencies installed.

```sh
pnpm exec playwright install chromium
BEETIP_MODE=connected VERCEL_ENV=production NEXT_PUBLIC_SUPABASE_URL='' NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='' APP_ORIGIN='' pnpm build
pnpm exec playwright test --config playwright.release.config.ts
```

For the local negative check, temporarily allowing `/admin` past the proxy guard caused the route test to fail with HTTP 500 instead of the required 307. The guard was restored before validation.

Bundle exclusion remains open for issue #23. Inspection on base `22b27c2acc09d2882a027e29dea041751ae8f507` found the `beetip-demo-v2` marker in a built JavaScript chunk under `apps/web/.next/static/chunks` and `/admin/page` and `/profile/page` in `apps/web/.next/server/app-paths-manifest.json`. The browser suite checks runtime enforcement for these surfaces. The broader multi-user rehearsal and device and load evidence remain separate release gates.
