# BTP-21 connected production startup

The release browser suite starts the compiled Next.js app on loopback in connected production mode with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `APP_ORIGIN` empty. It uses Chromium and synthetic demo browser state. It requires no database, account, or hosted service.

- The guest board and listing detail surface the catalog API's `503 UNAVAILABLE` with private, non-cacheable responses and no demo listings. Login, signup, account, and listing creation display the unavailable state without usable forms.
- Stale demo administrator state in browser storage grants no controls. Direct demo-only routes redirect to `/account`, seeded order and chat URLs show unavailable states, and staff reads and role changes return `503 UNAVAILABLE`.

The build selects the Next.js route files for the application mode. Connected builds omit the demo layout, demo pages and their browser-storage authority. Shared URLs such as `/orders/[id]` and `/chat/[orderId]` use connected implementations. Keep the same `BEETIP_MODE` when starting a build and rebuild when switching modes.

CI runs the demo browser suite, builds the connected candidate, checks its emitted artifacts, then starts that build for the release browser checks. Run these commands from PowerShell with Node 24.22.1 and the locked dependencies installed.

```powershell
rtk pnpm exec playwright install chromium
$env:BEETIP_MODE = 'connected'
$env:VERCEL_ENV = 'production'
$env:NEXT_PUBLIC_SUPABASE_URL = ''
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = ''
$env:APP_ORIGIN = ''
rtk pnpm build
rtk proxy node scripts/check-connected-build.mjs
rtk pnpm exec playwright test --config playwright.release.config.ts
```

The artifact check reads the app route manifest and scans emitted client and server JavaScript and source maps for demo authority markers. On base `695b811` it failed on all five demo-only route entries and the `beetip-demo-v2` marker in browser JavaScript, server JavaScript and a server source map. The browser suite also checks redirects and fail-closed behavior on the production server.

The broader multi-user rehearsal, physical-device checks and pilot load evidence remain release gates for issue #23.
