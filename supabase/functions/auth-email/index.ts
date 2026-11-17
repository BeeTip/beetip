import { Webhook } from "npm:standardwebhooks@1.0.0";
import { authEmailConfig, createAuthEmailHandler } from "./handler.ts";

const config = authEmailConfig(name => Deno.env.get(name));
const webhook = new Webhook(config.secret.replace(/^v1,whsec_/, ""));
Deno.serve(createAuthEmailHandler(config, (body, headers) => webhook.verify(body, headers)));
