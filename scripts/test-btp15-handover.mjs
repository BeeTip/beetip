import assert from "node:assert/strict";
import { createHash, randomUUID as uuid } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import pg from "pg";

const url = new URL(process.env.BEETIP_LOCAL_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55487/postgres");
assert(/^postgres(?:ql)?:$/.test(url.protocol) && url.hostname === "127.0.0.1" && !url.search,
  "Use disposable loopback PostgreSQL");
const admin = new pg.Client({ connectionString: url.href });
const database = `btp15_${uuid().replaceAll("-", "")}`;
url.pathname = `/${database}`;
const clients = [];
let created = false;
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const first = async (client, sql, params) => Object.values((await client.query(sql, params)).rows[0])[0];

async function connect() {
  const client = new pg.Client({ connectionString: url.href, statement_timeout: 15000 });
  await client.connect();
  clients.push(client);
  return client;
}

try {
  await admin.connect();
  for (const role of ["anon", "authenticated"]) {
    await admin.query(`do $$ begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role}; end if; end $$`);
  }
  await admin.query(`create database ${database} encoding 'UTF8' template template0`);
  created = true;
  const owner = await connect();
  await owner.query(read("../supabase/tests/local_platform.sql"));
  for (const migration of readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter(file => file.endsWith(".sql")).sort()) {
    await owner.query(read(`../supabase/migrations/${migration}`));
  }

  async function session(claims) {
    const client = await connect();
    await client.query("set role authenticated");
    await client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(claims)]);
    return client;
  }
  async function actor() {
    const id = uuid(), sessionId = uuid();
    await owner.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [id, `${id}@example.invalid`]);
    await owner.query("insert into auth.sessions(id,user_id) values($1,$2)", [sessionId, id]);
    const claims = { sub: id, session_id: sessionId, aal: "aal1" };
    return { id, claims, client: await session(claims) };
  }
  const provider = await actor(), customer = await actor(), outsider = await actor();
  const account = uuid();
  await owner.query("insert into private.funding_accounts(id,label) values($1,'Akun simulasi')", [account]);
  async function order({ buyer = customer, fund = true } = {}) {
    const listing = uuid(), offer = uuid();
    await owner.query(`insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
      values($1,$2,'trip','Uji serah terima','Warung','Makanan','Alam Sutera','Kampus',$3,40000,5000,5000,false,2,100000,
        now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours','active')`,
    [listing, provider.id, JSON.stringify([{ name: "Nasi", specification: "", quantity: 2, unitBudget: 20000 }])]);
    await buyer.client.query("select public.save_offer($1,$2,$3,0,1,5000,'save')", [uuid(), offer, listing]);
    const id = await first(provider.client, "select public.accept_order($1,$2,1,$3,1)", [uuid(), listing, offer]);
    if (fund) {
      await owner.query(`insert into private.funding_submissions(order_id,account_id,reference,amount,state,submitted_at,reviewed_at,reviewed_by)
        select $1,$2,$3,private.funding_required($1),'verified',now(),now(),$4`, [id, account, `TEST${uuid().replaceAll("-", "").toUpperCase()}`, outsider.id]);
      await owner.query("update public.reservations set funding_verified_at=now() where order_id=$1", [id]);
    }
    return id;
  }
  async function finish(id, quantity = 1) {
    const run = (key, action, payload) => first(provider.client, "select public.record_purchase($1,$2,1,$3,$4)", [key, id, action, payload]);
    if (quantity) {
      const key = uuid(), hash = createHash("sha256").update(key).digest("hex");
      await owner.query("insert into storage.objects(id,bucket_id,name,metadata) values($1,'purchase-receipts',$2,$3)",
        [uuid(), `${provider.id}/${id}/${key}/${hash}`, { mimetype: "image/png", size: 100 }]);
      const date = await first(owner, "select (now() at time zone 'Asia/Jakarta')::date::text");
      const receipt = await run(key, "receipt", { merchant: "Warung", reference: key.slice(0, 8), date, discount: 0, imageHash: hash,
        lines: [{ label: "Nasi", quantity, gross: 20000 * quantity }] });
      await run(uuid(), "allocate", { receipt, entries: [{ line: 1, item: 0, quantity }] });
    }
    await run(uuid(), "finish", quantity < 2 ? { unavailable: [0], note: "Stok habis" } : { unavailable: [], note: "" });
  }
  const start = (actor, id) => first(actor.client, "select public.start_delivery($1)", [id]);
  const state = (actor, id) => first(actor.client, "select public.read_order($1)->>'state'", [id]);
  const issue = (actor, id, checked = true) => first(actor.client, "select public.issue_handover_code($1,$2)", [id, checked]);
  const consume = (actor, id, code) => first(actor.client, "select public.confirm_handover($1,$2)", [
    id, createHash("sha256").update(`${id}:${code}`).digest("hex"),
  ]);

  const id = await order();
  await assert.rejects(start(provider, id), /CONFLICT/);
  await assert.rejects(issue(customer, id), /CONFLICT/);
  await finish(id);
  assert.equal(await state(customer, id), "purchase_partial");
  await assert.rejects(start(customer, id), /PERMISSION/);
  await assert.rejects(start(outsider, id), /PERMISSION/);
  await owner.query("update public.reservations set funding_verified_at=null where order_id=$1", [id]);
  await assert.rejects(start(provider, id), /CONFLICT/);
  await owner.query("update public.reservations set funding_verified_at=now() where order_id=$1", [id]);
  await start(provider, id);
  assert.equal(await state(customer, id), "delivering");
  await assert.rejects(issue(provider, id), /PERMISSION/);
  await assert.rejects(issue(outsider, id), /PERMISSION/);
  await assert.rejects(issue(customer, id, false), /VALIDATION/);
  const issued = await issue(customer, id);
  assert(/^[A-F0-9]{12}$/.test(issued.code), "Customer receives a manual code");
  const time = (await owner.query("select extract(epoch from (expires_at-issued_at))::int as seconds from private.handover_challenges where order_id=$1", [id])).rows[0];
  assert.equal(time.seconds, 60);
  assert(Number.isFinite(Date.parse(issued.expiresAt)));
  await assert.rejects(provider.client.query("select * from private.handover_challenges"), /permission denied/);
  const anon = await connect();
  await anon.query("set role anon");
  await assert.rejects(anon.query("select public.issue_handover_code($1,true)", [id]), /permission denied/);
  await assert.rejects(anon.query("select public.confirm_handover($1,$2)", [id, "0".repeat(64)]), /permission denied/);
  const revoked = { client: await session({ ...provider.claims, session_id: uuid() }) };
  await assert.rejects(consume(revoked, id, issued.code), /PERMISSION/);
  const providerStatus = await first(owner, "select status from public.members where id=$1", [provider.id]);
  await owner.query("update public.members set status='suspended' where id=$1", [provider.id]);
  await assert.rejects(consume(provider, id, issued.code), /PERMISSION/);
  await owner.query("update public.members set status=$2 where id=$1", [provider.id, providerStatus]);
  await assert.rejects(consume(customer, id, issued.code), /PERMISSION/);
  await assert.rejects(consume(outsider, id, issued.code), /PERMISSION/);
  await assert.rejects(consume(provider, uuid(), issued.code), /PERMISSION/);
  const other = await order();
  await finish(other, 2);
  await start(provider, other);
  const otherCode = await issue(customer, other);
  assert.equal(await consume(provider, other, issued.code), "invalid", "Code is bound to its order");
  const unavailable = await order();
  await finish(unavailable, 0);
  await assert.rejects(start(provider, unavailable), /CONFLICT/);

  const ordinaryUnpaid = await order({ fund: false });
  assert.equal(await state(customer, ordinaryUnpaid), "awaiting_payment");
  await assert.rejects(finish(ordinaryUnpaid), /CONFLICT: Purchase funding/);
  await assert.rejects(customer.client.query("insert into private.booth_members values($1)", [customer.id]), /permission denied/);
  await owner.query("insert into private.booth_members values($1),($2)", [provider.id, customer.id]);
  assert.equal(await state(customer, ordinaryUnpaid), "awaiting_payment", "Existing orders keep their payment rules");
  await assert.rejects(order({ buyer: outsider, fund: false }), /Booth accounts can only order with another booth account/);
  const booth = await order({ fund: false });
  assert.equal(await state(customer, booth), "booth_ready");
  assert.equal(await first(outsider.client, "select count(*)::int from public.orders where id=$1", [booth]), 0);
  const reservation = await first(owner, "select row_to_json(r) from (select expires_at, funding_verified_at from public.reservations where order_id=$1) r", [booth]);
  assert(Date.parse(reservation.expires_at) > Date.now()+23*60*60*1000);
  assert.equal(reservation.funding_verified_at, null);
  await assert.rejects(owner.query("insert into private.funding_submissions(order_id,account_id,reference,amount) values($1,$2,'BOOTHPAYMENT',45000)", [booth, account]), /Payment is disabled/);
  await first(customer.client, "select public.btp08_send($1,$2,'Siap untuk demo')", [booth, uuid()]);
  const history = await first(provider.client, "select public.btp08_history($1)", [booth]);
  assert.match(JSON.stringify(history), /Siap untuk demo/);
  await assert.rejects(outsider.client.query("select public.btp08_history($1)", [booth]), /PERMISSION/);
  await finish(booth, 2);
  await start(provider, booth);
  assert.equal(await consume(provider, booth, (await issue(customer, booth)).code), "confirmed");
  assert.equal(await state(customer, booth), "delivery_confirmed");
  assert.equal(await first(owner, "select count(*)::int from private.funding_submissions where order_id=$1", [booth]), 0);

  const attempts = () => first(owner, "select failed_attempts from private.handover_challenges where order_id=$1", [id]);
  assert.equal(await attempts(), 0);

  await owner.query("update private.handover_challenges set expires_at=clock_timestamp() where order_id=$1", [id]);
  assert.equal(await consume(provider, id, issued.code), "expired");
  const second = await issue(customer, id);
  assert.equal(await consume(provider, id, issued.code), "invalid");
  const wrong = second.code.replace(/^./, second.code.startsWith("A") ? "B" : "A");
  for (let attempt = 2; attempt <= 5; attempt++) {
    assert.equal(await consume(provider, id, wrong), attempt === 5 ? "locked" : "invalid");
    assert.equal(await attempts(), attempt);
  }
  assert.equal(await consume(provider, id, second.code), "locked");
  assert.equal(await attempts(), 5);
  const third = await issue(customer, id);
  assert.equal(await attempts(), 0);

  await owner.query(`create function private.btp15_fail_confirmation() returns trigger language plpgsql as $$
    begin if new.event_type='handover_confirmed' then raise exception 'Test audit failure'; end if; return new; end; $$;
    create trigger btp15_fail_confirmation before insert on private.audit_events
      for each row execute function private.btp15_fail_confirmation()`);
  await assert.rejects(consume(provider, id, third.code), /Test audit failure/);
  assert.equal(await state(customer, id), "delivering");
  assert.equal(await first(owner, "select consumed_at from private.handover_challenges where order_id=$1", [id]), null);
  await owner.query("drop trigger btp15_fail_confirmation on private.audit_events");

  const locker = await connect(), racer = { client: await session(provider.claims) };
  await locker.query("begin");
  await locker.query("select id from public.orders where id=$1 for update", [id]);
  const results = Promise.allSettled([consume(provider, id, third.code), consume(racer, id, third.code)]);
  try {
    for (const client of [provider.client, racer.client]) {
      for (let attempt = 0; ; attempt++) {
        if (await first(owner, "select wait_event_type from pg_stat_activity where pid=$1", [client.processID]) === "Lock") break;
        assert(attempt < 200, "Both scans must reach the same order lock");
        await setTimeout(10);
      }
    }
  } finally { await locker.query("rollback"); }
  assert.deepEqual((await results).map(row => row.value).sort(), ["confirmed", "replayed"]);
  assert.equal(await state(customer, id), "delivery_confirmed");
  assert.equal(await consume(provider, id, third.code), "replayed");
  await assert.rejects(issue(customer, id), /CONFLICT/);
  assert.equal(await first(owner, "select count(*)::int from private.audit_events where target_id=$1 and event_type='handover_confirmed'", [id]), 1);
  assert.equal(await first(owner, "select count(*)::int from private.audit_events where target_id=$1 and event_type='handover_rejected'", [id]), 9);
  const projections = await Promise.all([
    first(provider.client, "select public.read_purchase($1)", [id]),
    first(customer.client, "select public.read_order($1)", [id]),
    first(customer.client, "select public.browse_orders()", []),
    first(owner, "select jsonb_agg(h) from private.handover_challenges h"),
    first(owner, "select jsonb_agg(a) from private.audit_events a"),
    first(owner, "select jsonb_agg(o) from private.operation_receipts o"),
  ]);
  for (const code of [issued.code, second.code, third.code, otherCode.code, wrong]) {
    assert(!JSON.stringify(projections).includes(code), "Raw handover material must stay out of persisted and read projections");
  }
  assert.equal(projections[0].state, "purchase_partial");
  assert.equal(projections[2].find(row => row.id === id)?.state, "delivery_confirmed");
  console.log("PASS BTP-15 SQL roles, completed shopping, 60-second expiry, regeneration, five attempts, cross-order rejection, atomic rollback, concurrent scans, replay, and sanitized storage");
} finally {
  await Promise.allSettled(clients.map(client => client.end()));
  if (created) await admin.query(`drop database ${database}`);
  await admin.end();
}
