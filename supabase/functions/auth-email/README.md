# Staging Auth email recipient guard

This function uses BeeTip's dedicated project and fixed application origin. It replaces Auth's direct SMTP send when enabled. It sends only signup and recovery email. `BEETIP_AUTH_EMAIL_AUDIENCE=allowlist` (the default) restricts recipients to `BEETIP_AUTH_EMAIL_RECIPIENTS`; explicit `public` permits open onboarding with validated recipient addresses. Other email actions are rejected before contacting Brevo. The owner's [public onboarding policy](../../../docs/public-onboarding.md) supersedes the earlier closed staging cohort.

The gateway JWT check is disabled because the function validates Standard Webhooks signatures over the raw body, including the SDK's timestamp tolerance. Unsigned, changed, stale, oversized, and unsupported requests fail closed. Provider requests use a fixed HTTPS endpoint, reject redirects, have a 3.5-second timeout, and never log bodies, tokens, addresses, or keys. A successful response means Brevo accepted the send; mailbox delivery must be verified separately.

## Configuration

Store the settings from `.env.example` in the dedicated project's Edge Function secret store. The hook secret must match the secret in the hosted Auth Send Email Hook configuration. Generate a fresh random signing secret; do not reuse an API key. Use a restricted Brevo key with only the Transactional email resource enabled. Provider and signing credentials never belong in Vercel or browser settings.

Set the hosted hook URI to `https://rgiptdfjlmwldngapojq.supabase.co/functions/v1/auth-email`. Enable it only after deploying the exact reviewed source, verifying unsigned and signed-but-unapproved requests are denied, and confirming the secret names exist. Read back the Auth hook fields without exposing their values. Verify a real approved recovery email and complete its password-change flow after activation.

The function sends a single-use token-hash link to the fixed application's `/auth/confirm` endpoint. That route validates the token with Supabase and creates a session even in a fresh browser context, then opens the dashboard or an explicitly supported signup return destination. It ignores payload `site_url`; that field never determines the email link. Hook input callbacks must match `/auth/callback`, with signup `next` limited to `/account`, `/support`, or `/listings/new`; recovery requires `next=/auth/password`. Local email callbacks, email changes, invitations, magic links and notifications remain unsupported.

Public signup is enabled under the maker's current policy. Isolated test environments can close signup and select the default allowlist audience. Do not disable the signed hook as a mail-outage workaround. Stop mail operations and repair its configuration while preserving signature, recipient and callback validation.

## Validation and reproduction

Run `pnpm test` for the handler tests and existing unit suite, `pnpm lint`, and `pnpm typecheck`. The Edge entrypoint is compiled by the deployment runtime; the shared handler is also checked by the repository TypeScript configuration through its tests. Upload `index.ts`, `handler.ts`, and `deno.json` together, with gateway JWT verification disabled as recorded in `supabase/config.toml`. No database migration is required by this function.

For a clean environment, apply all four migrations in order to a fresh dedicated nonproduction database, generate its types, run the database assertions, configure exact callbacks and confirmed Auth, configure a verified free Brevo sender, provision these secrets, deploy the function, and enable the signed Auth hook. Review and update the fixed application origin before using another isolated environment. Never point a preview at production.

Auth retries and provider acceptance can produce duplicate emails after an uncertain response. This hook adds no application outbox, reconciliation worker, or financial operation. Those are later owning issues. Provider sender rewriting, click tracking, Spam placement, expiry limits, and account/key quotas remain operational facts to record in [the staging acceptance evidence](../../../docs/staging.md).
