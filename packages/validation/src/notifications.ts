import { z } from "zod";

export const notificationEventTypes = [
  "affiliation_decided", "offer_received", "offer_changed", "offer_withdrawn", "listing_changed",
  "support_opened", "support_assigned", "support_message", "staff_role_changed",
  "order_accepted", "order_expired", "order_cancelled", "funding_review", "amendment_action",
  "delivery_confirmed", "order_message", "dispute_opened", "dispute_resolved", "transfer_review", "transfer_outcome",
] as const;
export type NotificationEventType = typeof notificationEventTypes[number];
type Rule = {
  recipients: "applicant" | "listing_owner" | "offer_authors" | "support_queue" | "support_members" | "member" | "order_parties" | "parties_and_assignees" | "other_participant";
  target: "affiliation" | "offer" | "listing" | "support_queue" | "conversation" | "account" | "order";
  template: string;
  title: string;
  email: "summary" | "unread_window" | "in_app_only";
  implemented: boolean;
};
export const notificationRegistrySeed = {
  affiliation_decided: { recipients: "applicant", target: "affiliation", template: "affiliation_decided.v1", title: "Hasil pemeriksaan afiliasi tersedia", email: "summary", implemented: true },
  offer_received: { recipients: "listing_owner", target: "offer", template: "offer_received.v1", title: "Penawaran baru diterima", email: "summary", implemented: true },
  offer_changed: { recipients: "listing_owner", target: "offer", template: "offer_changed.v1", title: "Penawaran diperbarui", email: "summary", implemented: true },
  offer_withdrawn: { recipients: "listing_owner", target: "offer", template: "offer_withdrawn.v1", title: "Penawaran ditarik", email: "summary", implemented: true },
  listing_changed: { recipients: "offer_authors", target: "listing", template: "listing_changed.v1", title: "Rincian titipan berubah", email: "summary", implemented: true },
  support_opened: { recipients: "support_queue", target: "support_queue", template: "support_opened.v1", title: "Permintaan bantuan baru", email: "summary", implemented: true },
  support_assigned: { recipients: "support_members", target: "conversation", template: "support_assigned.v1", title: "Penugasan bantuan diperbarui", email: "summary", implemented: true },
  support_message: { recipients: "support_members", target: "conversation", template: "support_message.v1", title: "Pesan bantuan baru", email: "unread_window", implemented: false },
  staff_role_changed: { recipients: "member", target: "account", template: "staff_role_changed.v1", title: "Peran akun diperbarui", email: "summary", implemented: true },
  order_accepted: { recipients: "order_parties", target: "order", template: "order_accepted.v1", title: "Penawaran disepakati", email: "summary", implemented: true },
  order_expired: { recipients: "order_parties", target: "order", template: "order_expired.v1", title: "Pesanan kedaluwarsa", email: "summary", implemented: false },
  order_cancelled: { recipients: "order_parties", target: "order", template: "order_cancelled.v1", title: "Pembatalan pesanan diperbarui", email: "summary", implemented: false },
  funding_review: { recipients: "parties_and_assignees", target: "order", template: "funding_review.v1", title: "Pemeriksaan dana diperbarui", email: "summary", implemented: false },
  amendment_action: { recipients: "parties_and_assignees", target: "order", template: "amendment_action.v1", title: "Perubahan pesanan perlu diperiksa", email: "summary", implemented: false },
  delivery_confirmed: { recipients: "parties_and_assignees", target: "order", template: "delivery_confirmed.v1", title: "Serah terima dikonfirmasi", email: "summary", implemented: false },
  order_message: { recipients: "other_participant", target: "order", template: "order_message.v1", title: "Pesan pesanan baru", email: "unread_window", implemented: false },
  dispute_opened: { recipients: "parties_and_assignees", target: "order", template: "dispute_opened.v1", title: "Sengketa dibuka", email: "summary", implemented: false },
  dispute_resolved: { recipients: "parties_and_assignees", target: "order", template: "dispute_resolved.v1", title: "Sengketa diselesaikan", email: "summary", implemented: false },
  transfer_review: { recipients: "parties_and_assignees", target: "order", template: "transfer_review.v1", title: "Transfer perlu diperiksa", email: "summary", implemented: false },
  transfer_outcome: { recipients: "parties_and_assignees", target: "order", template: "transfer_outcome.v1", title: "Status transfer diperbarui", email: "summary", implemented: false },
} as const satisfies Record<NotificationEventType, Rule>;

export const notificationRegistry = {
  ...notificationRegistrySeed,
  support_opened: { ...notificationRegistrySeed.support_opened, email: "in_app_only" },
  support_message: { ...notificationRegistrySeed.support_message, implemented: true },
} as const satisfies Record<NotificationEventType, Rule>;

export const notificationQuerySchema = z.object({ before: z.iso.datetime({ offset: true }).optional(), beforeId: z.uuid().optional() }).strict()
  .refine(value => Boolean(value.before) === Boolean(value.beforeId));
export const notificationCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), id: z.uuid() }).strict(),
  z.object({ action: z.literal("preference"), eventType: z.enum(notificationEventTypes), email: z.boolean() }).strict(),
]);
export type InboxNotification = { id: string; event_type: NotificationEventType; created_at: string; read_at: string | null };
export type NotificationPreference = { event_type: NotificationEventType; email_enabled: boolean };
