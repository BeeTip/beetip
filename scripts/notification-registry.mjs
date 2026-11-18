import { readFileSync, writeFileSync } from "node:fs";
import { notificationRegistry } from "../packages/validation/src/notifications.ts";

export const migrationPath = new URL("../supabase/migrations/20261119000000_notification_inbox.sql", import.meta.url);
export function registrySql() {
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  return "insert into private.notification_rules(event_type,recipient_rule,target_kind,template,title,email_mode,implemented) values\n" +
    Object.entries(notificationRegistry).map(([event, rule]) => `  (${[event, rule.recipients, rule.target, rule.template, rule.title, rule.email].map(quote).join(",")},${event === "funding_review" ? false : rule.implemented})`).join(",\n") + ";";
}
const source = readFileSync(migrationPath, "utf8");
const generated = source.replace(/-- registry:start[\s\S]*?-- registry:end/, `-- registry:start\n${registrySql()}\n-- registry:end`.replaceAll("\n", source.includes("\r\n") ? "\r\n" : "\n"));
if (process.argv.includes("--write")) writeFileSync(migrationPath, generated);
else if (generated !== source) throw new Error("Notification registry SQL drift. Run rtk proxy node --experimental-strip-types scripts/notification-registry.mjs --write");
