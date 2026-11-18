import { Webhook } from "npm:standardwebhooks@1.0.0";
import { authEmailConfig, createAuthEmailHandler } from "./handler.ts";

const config = authEmailConfig(name => Deno.env.get(name));
const webhook = new Webhook(config.secret.replace(/^v1,whsec_/, ""));
const handler = createAuthEmailHandler(config, (body, headers) => webhook.verify(body, headers));
Deno.serve(async request => {
  const response = await handler(request);
  if (response.status === 400) {
    const result = await response.clone().json();
    console.warn("Auth email rejected:", result.error.message);
  }
  return response;
});
