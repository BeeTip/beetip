import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

const workdir = process.env.BEETIP_TEST_LOCAL_STACK;
assert(workdir, "Use a disposable Supabase work directory");
const stack = JSON.parse(execFileSync("rtk", ["proxy", "supabase", "status", "-o", "json", "--workdir", workdir], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
}));
const origin = process.env.BEETIP_TEST_URL;
const mail = stack.MAILPIT_URL ?? stack.INBUCKET_URL;
for (const value of [origin, mail, stack.API_URL]) assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(value), "Only disposable loopback services are supported");

const email = `btp-auth-${randomUUID()}@example.com`;
const password = randomUUID();
const replacement = randomUUID();

async function mailLink(excludedId) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await fetch(`${mail}/api/v1/messages`, { signal: AbortSignal.timeout(3000) });
    assert(response.ok, "Local mail inbox unavailable");
    const { messages } = await response.json();
    const message = messages?.find(item => item.ID !== excludedId && item.To.some(recipient => recipient.Address === email));
    if (message) {
      const detail = await fetch(`${mail}/api/v1/message/${encodeURIComponent(message.ID)}`, { signal: AbortSignal.timeout(3000) });
      assert(detail.ok, "Local email unavailable");
      const { HTML } = await detail.json();
      const href = HTML?.match(/<a\b[^>]*\bhref="([^"]+)"/i)?.[1];
      assert(href, "Local email is missing its action link");
      const link = new URL(href.replaceAll("&amp;", "&"));
      assert([origin, stack.API_URL].includes(link.origin), "Local email link points outside the disposable rehearsal");
      return { id: message.ID, link };
    }
    await delay(500);
  }
  throw new Error("Local mail did not arrive");
}

function submit(context, fields) {
  return context.request.post(`${origin}/api/identity/auth`, { headers: { Origin: origin }, data: fields, maxRedirects: 0 });
}

async function openLink(context, link, destination, failure) {
  let url = link;
  for (let step = 0; step < 4; step++) {
    assert([origin, stack.API_URL].includes(url.origin), "Auth link redirected outside the disposable rehearsal");
    if (url.origin === origin && url.pathname === destination) return;
    const response = await context.request.get(url.href, { maxRedirects: 0 }).catch(() => { throw new Error(failure); });
    const location = response.headers().location;
    if (!location) break;
    url = new URL(location, url);
  }
  throw new Error(failure);
}

const browser = await chromium.launch({ executablePath: process.env.BEETIP_BROWSER_EXECUTABLE });
try {
  const signup = await browser.newContext();
  assert((await submit(signup, { action: "signup", email, name: "Penguji BeeTip", password, next: "/listings/new" })).ok(), "Signup request failed");
  const confirmation = await mailLink();
  const customer = await browser.newContext();
  assert.equal((await submit(customer, { action: "login", email, password })).status(), 400, "Unconfirmed user must be denied");
  await openLink(customer, confirmation.link, "/listings/new", "Signup link did not continue in a fresh session");
  assert.equal((await customer.request.get(`${origin}/account`, { maxRedirects: 0 })).status(), 200, "Confirmation did not establish an account session");
  console.log("PASS local signup mail confirms the account and preserves its requested destination in a fresh session");

  const recovery = await browser.newContext();
  const recoveryRequest = await submit(recovery, { action: "recover", email });
  assert(recoveryRequest.ok(), "Recovery request failed");
  assert.match((await recoveryRequest.json()).message, /tautan pemulihan.*kata sandi baru/, "Recovery must explain the next step");
  const reset = await mailLink(confirmation.id);
  const fresh = await browser.newContext();
  await openLink(fresh, reset.link, "/auth/password", "Recovery link did not open the password page in a fresh session");
  assert((await submit(fresh, { action: "password", password: replacement })).ok(), "Password change failed");
  const login = await browser.newContext();
  assert.equal((await submit(login, { action: "login", email, password })).status(), 400, "Previous password still works");
  assert((await submit(login, { action: "login", email, password: replacement })).ok(), "New password did not work");
  console.log("PASS local recovery mail works in a fresh session and replaces the old password");
} finally {
  await browser.close();
}
