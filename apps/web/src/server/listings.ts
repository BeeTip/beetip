import "server-only";
import type { OwnListing } from "@beetip/validation";
import type { Database } from "@beetip/database/types";

export function ownListing(row: Database["public"]["Tables"]["listings"]["Row"]): OwnListing {
  return { id: row.id, type: row.type as OwnListing["type"], title: row.title, shop: row.shop, category: row.category as OwnListing["category"], area: row.area, destination: row.destination, items: row.items as OwnListing["items"], budget: row.budget, fee: row.fee, bound: row.bound, negotiable: row.negotiable, capacity: row.capacity, spendingCapacity: row.spending_capacity, start: row.start_at, end: row.end_at, cutoff: row.cutoff_at, status: row.status as OwnListing["status"], version: row.version, created_at: row.created_at, moderated: row.moderation_hold !== null };
}
