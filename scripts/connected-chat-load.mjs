import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { request } from "@playwright/test";

async function json(response, operation) {
  assert.equal(response.status(), 200, `${operation} returned HTTP ${response.status()}`);
  return response.json();
}

export async function rehearseConnectedChatLoad({ admin, origin, sql }) {
  const run = randomUUID();
  const members = [];
  const sessions = [];
  try {
    for (let offset = 0; offset < 50; offset += 5) {
      const created = await Promise.all(Array.from({ length: 5 }, async (_, i) => {
        const email = `connected-load-${run}-${offset + i}@example.invalid`;
        const password = randomBytes(24).toString("base64url");
        const { data, error } = await admin.auth.admin.createUser({
          email, password, email_confirm: true, user_metadata: { display_name: "Penguji beban" },
        });
        assert.ifError(error);
        assert(data.user.email_confirmed_at);
        return { id: data.user.id, email, password };
      }));
      members.push(...created);
    }

    for (const { id, email, password } of members.slice(0, 20)) {
      const context = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin }, timeout: 10000 });
      sessions.push({ id, context });
      await json(await context.post("/api/identity/auth", { data: { action: "login", email, password } }), "Sign in");
    }

    const orders = [];
    for (let i = 0; i < sessions.length; i += 2) {
      const [customer, provider] = sessions.slice(i, i + 2);
      const listingId = randomUUID();
      await sql.query(`insert into public.listings
        (id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
        values($1,$2,'request','Uji beban','Warung','Makanan','Alam Sutera','Lobi','[{"name":"Nasi","specification":"","quantity":1,"unitBudget":20000}]',
          20000,5000,5000,false,1,150000,now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours','active')`, [listingId, customer.id]);
      const { orderId } = await json(await provider.context.post("/api/identity/orders", {
        headers: { "X-Beetip-Member": provider.id },
        data: { operationId: randomUUID(), listingId, listingVersion: 1 },
      }), "Accept load fixture order");
      orders.push({ orderId, participants: [customer, provider] });
    }

    const latency = [];
    const expected = new Map();
    for (let round = 0; round < 3; round++) {
      await Promise.all(orders.flatMap(({ orderId, participants }) => participants.map(async ({ id, context }) => {
        const body = `Pesan uji ${randomUUID()}`;
        const start = performance.now();
        const { message, memberId } = await json(await context.post("/api/identity/chat", {
          headers: { "X-Beetip-Member": id },
          data: { action: "send", order: orderId, clientId: randomUUID(), body },
        }), "Send chat message");
        latency.push(performance.now() - start);
        assert.equal(memberId, id);
        assert.equal(message.body, body);
        expected.set(message.id, body);
      })));
    }

    let durableMessages = 0;
    for (const { orderId, participants: [reader] } of orders) {
      const { page } = await json(await reader.context.get(`/api/identity/chat?order=${orderId}&after=0`), "Read persisted chat history");
      assert.deepEqual(page.messages.map(message => message.sequence), [1, 2, 3, 4, 5, 6]);
      for (const message of page.messages) assert.equal(message.body, expected.get(message.id));
      durableMessages += page.messages.length;
    }
    const intents = await sql.query(`select count(*)::int as count from private.notification_delivery_intents
      where event_id = any($1::uuid[]) and channel='email' and status='pending'`, [[...expected.keys()]]);
    assert.equal(intents.rows[0].count, latency.length, "Every chat acknowledgment must have an email intent");

    latency.sort((a, b) => a - b);
    return {
      members: members.length, sessions: sessions.length, orders: orders.length,
      acknowledgments: latency.length, durableMessages, emailIntents: intents.rows[0].count,
      p95Ms: Math.round(latency[Math.ceil(latency.length * 0.95) - 1]),
    };
  } finally {
    await Promise.all(sessions.map(({ context }) => context.dispose()));
  }
}
