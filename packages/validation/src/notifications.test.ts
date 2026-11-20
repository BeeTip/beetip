import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { notificationCommandSchema, notificationEventTypes, notificationQuerySchema, notificationRegistry, notificationRegistrySeed } from "./notifications";

describe("notification boundary and registry", () => {
  it("keeps every event, recipient rule, template, target and rollout flag in SQL parity", () => {
    const migration = readFileSync(new URL("../../../supabase/migrations/20261119000000_notification_inbox.sql", import.meta.url), "utf8");
    const region = migration.split("-- registry:start")[1].split("-- registry:end")[0];
    expect(Object.keys(notificationRegistry).sort()).toEqual([...notificationEventTypes].sort());
    expect(region.match(/^  \('/gm)).toHaveLength(Object.keys(notificationRegistrySeed).length);
    for (const [event, rule] of Object.entries(notificationRegistrySeed)) {
      expect(region).toContain(`('${event}','${rule.recipients}','${rule.target}','${rule.template}','${rule.title}','${rule.email}',${rule.implemented})`);
    }
    const funding = readFileSync(new URL("../../../supabase/migrations/20261119001000_btp12_incoming_funding.sql", import.meta.url), "utf8");
    expect(funding).toContain(`update private.notification_rules set implemented=${notificationRegistry.funding_review.implemented} where event_type='funding_review';`);
    const moderation = readFileSync(new URL("../../../supabase/migrations/20261121002100_btp19_moderation_ratings.sql", import.meta.url), "utf8");
    const rule = notificationRegistry.listing_moderated;
    expect(moderation).toContain(`('listing_moderated','${rule.recipients}','${rule.target}','${rule.template}','${rule.title}','${rule.email}',${rule.implemented})`);
  });
  it("exposes case lifecycle notifications and keeps ordinary case activity in app", () => {
    const cases = readFileSync(new URL("../../../supabase/migrations/20261119141454_btp16_order_cases.sql", import.meta.url), "utf8");
    expect(notificationRegistry).toMatchObject({
      order_case_activity: { email: "in_app_only", implemented: true },
      order_cancelled: { implemented: true },
      dispute_opened: { implemented: true },
      dispute_resolved: { implemented: true },
    });
    expect(cases).toContain("('order_case_activity','parties_and_assignees','order','order_case_activity.v1','Kasus pesanan diperbarui','in_app_only',true)");
  });
  it("offers email preferences for support replies, with queue alerts delivered in app", () => {
    expect(notificationRegistry.support_opened.email).toBe("in_app_only");
    expect(notificationRegistry.support_message).toMatchObject({ implemented: true, email: "unread_window" });
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
