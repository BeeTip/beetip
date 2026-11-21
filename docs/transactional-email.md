# Application email retirement

BeeTip sends signup confirmation and password-reset email through the [Supabase Auth hook](../supabase/functions/auth-email/README.md). Order updates, chat, and other application notifications appear in the [private inbox](notifications.md).

Migration `20261121024423_retire_application_email.sql` retires the application email worker, provider callback, scheduled jobs, replay operations and email preferences. The migration suppresses pending work and retains historical delivery outcomes. The Auth hook, its provider settings, and the notification inbox remain available.

In the [public onboarding record](public-onboarding.md), signup confirmation and password recovery were verified through actual delivered email. The retired app email worker had previously been tested on disposable stacks with mocked provider transport and was never enabled on the public booth.
