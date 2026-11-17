# Staging Auth email recipient guard

This function is restricted to BeeTip's development project and protected staging origin. It replaces Auth's direct SMTP send when enabled. It sends only signup and recovery email to the exact recipients in `BEETIP_AUTH_EMAIL_RECIPIENTS`. Other recipients and other email actions are rejected before contacting Brevo.

The gateway JWT check is disabled because the function validates Standard Webhooks signatures over the raw body, including the SDK's timestamp tolerance. Unsigned, changed, stale, oversized, and unsupported requests fail closed. Provider requests use a fixed HTTPS endpoint, reject redirects, have a 3.5-second timeout, and never log bodies, tokens, addresses, or keys. A successful response means Brevo accepted the send; mailbox delivery must be verified separately.

## Configuration

Store the four settings from `.env.example` in the dedicated project's Edge Function secret store. The hook secret must match the secret in the hosted Auth Send Email Hook configuration. Generate a fresh random signing secret; do not reuse an API key. Use a restricted Brevo key with only the Transactional email resource enabled. Provider and signing credentials never belong in Vercel or browser settings.

Set the hosted hook URI to `https://rgiptdfjlmwldngapojq.supabase.co/functions/v1/auth-email`. Enable it only after deploying the exact reviewed source, verifying unsigned and signed-but-unapproved requests are denied, and confirming the secret names exist. Read back the Auth hook fields without exposing their values. Verify a real approved recovery email and complete its password-change flow after activation.

The function uses the development project's `/auth/v1/verify` endpoint so the existing PKCE callback flow remains intact. Recovery redirects only to `/auth/callback?next=/auth/password`; signup redirects only to `/auth/callback`. Local email callbacks, email-change mail, invitations, magic links, and Auth notifications are not enabled by this staging function. Extending those flows requires their own validated contracts.

The public signup gate can remain closed after acceptance, limiting registration to the existing approved cohort. That gate alone is not a recipient filter; this signed send hook enforces the recipient restriction even for existing-account email paths. Do not disable the hook as a mail-outage workaround. Stop mail operations and repair the function or its configuration while preserving the recipient restriction.

## Validation and reproduction

Run `pnpm test` for the handler tests and existing unit suite, `pnpm lint`, and `pnpm typecheck`. The Edge entrypoint is compiled by the deployment runtime; the shared handler is also checked by the repository TypeScript configuration through its tests. Upload `index.ts`, `handler.ts`, and `deno.json` together, with gateway JWT verification disabled as recorded in `supabase/config.toml`. No database migration is required by this function.

For a clean environment, apply the three reconciled migrations to a fresh dedicated nonproduction database, generate its types, run the database assertions, configure exact callbacks and confirmed Auth, configure a verified free Brevo sender, provision these secrets, deploy the function, and enable the signed Auth hook. This checked-in function deliberately rejects a different project/origin; review and update those fixed targets before using another isolated environment. Never point a preview at production.

Auth retries and provider acceptance can produce duplicate emails after an uncertain response. This hook adds no application outbox, reconciliation worker, or financial operation. Those are later owning issues. Provider sender rewriting, click tracking, Spam placement, expiry limits, and account/key quotas remain operational facts to record in [the staging acceptance evidence](../../../docs/staging.md).
