import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { identityConfig } from "./config";
import type { Database } from "@beetip/database/types";

export async function identityClient() {
  const config = identityConfig();
  const store = await cookies();
  return createServerClient<Database>(config.url, config.key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(values) {
        try { values.forEach(({ name, value, options }) => store.set(name, value, options)); }
        catch { /* Server Components receive refreshed cookies from the request proxy. */ }
      },
    },
  });
}

export async function currentMember() {
  const client = await identityClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user || !user.email_confirmed_at || user.is_anonymous) return null;
  const { data: member, error: memberError } = await client.from("members").select("id, display_name, status").eq("id", user.id).single();
  if (memberError) throw new Error("Membership could not be loaded");
  return { id: user.id, name: String(member.display_name), status: String(member.status) };
}
