import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { notificationCommandSchema, notificationEventTypes, notificationQuerySchema, notificationRegistry } from "./notifications";

describe("notification boundary and registry", () => {
  it("keeps every event, recipient rule, template, target and rollout flag in SQL parity", () => {
    const migration = readFileSync(new URL("../../../supabase/migrations/20261119000000_notification_inbox.sql", import.meta.url), "utf8");
    const region = migration.split("-- registry:start")[1].split("-- registry:end")[0];
    expect(Object.keys(notificationRegistry).sort()).toEqual([...notificationEventTypes].sort());
    expect(region.match(/^  \('/gm)).toHaveLength(notificationEventTypes.length);
    for (const [event, rule] of Object.entries(notificationRegistry)) {
      expect(region).toContain(`('${event}','${rule.recipients}','${rule.target}','${rule.template}','${rule.title}','${rule.email}',${rule.implemented})`);
    }
  });
  it("rejects actor spoofing and read reversal", () => {
    const read = { action: "read", id: "00000000-0000-4000-8000-000000000001" };
    expect(notificationCommandSchema.safeParse(read).success).toBe(true);
    expect(notificationCommandSchema.safeParse({ ...read, recipientId: read.id }).success).toBe(false);
    expect(notificationCommandSchema.safeParse({ ...read, read: false }).success).toBe(false);
    expect(notificationCommandSchema.safeParse({ action: "preference", eventType: "unknown", email: true }).success).toBe(false);
  });
  it("requires a complete keyset cursor and rejects arbitrary target input", () => {
    expect(notificationQuerySchema.safeParse({}).success).toBe(true);
    expect(notificationQuerySchema.safeParse({ before: "2026-11-18T01:00:00Z" }).success).toBe(false);
    expect(notificationQuerySchema.safeParse({ target: "https://untrusted.invalid" }).success).toBe(false);
    expect(notificationQuerySchema.safeParse({ before: "2026-11-18T01:00:00Z", beforeId: "00000000-0000-4000-8000-000000000001" }).success).toBe(true);
  });
});
