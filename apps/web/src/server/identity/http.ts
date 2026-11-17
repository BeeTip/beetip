import "server-only";
import { NextResponse } from "next/server";
import { acceptsMutation } from "@beetip/validation";
import { identityConfig, mode } from "./config";

export function reply(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function mutationBody(request: Request) {
  if (mode() !== "connected") throw new Error("UNAVAILABLE");
  const { origin } = identityConfig();
  if (!acceptsMutation(request.headers.get("origin"), origin, request.headers.get("content-type"))) throw new Error("PERMISSION");
  if (Number(request.headers.get("content-length") ?? "0") > 8192) throw new Error("VALIDATION");
  const text = await request.text();
  if (Buffer.byteLength(text) > 8192) throw new Error("VALIDATION");
  try { return JSON.parse(text); } catch { throw new Error("VALIDATION"); }
}

export function boundaryFailure(error: unknown) {
  const code = error instanceof Error ? error.message : "UNAVAILABLE";
  if (code === "PERMISSION") return reply({ ok: false, code, message: "Permintaan tidak diizinkan." }, 403);
  if (code === "VALIDATION") return reply({ ok: false, code, message: "Periksa data yang dikirim." }, 400);
  return reply({ ok: false, code: "UNAVAILABLE", message: "Layanan belum tersedia. Coba lagi nanti." }, 503);
}
