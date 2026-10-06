"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createSeed, DemoService, type Command, type Result, type State } from "@beetip/domain";
import { demoStorageSchema } from "@beetip/validation";

const key = "beetip-demo-v1";
type DemoContext = { service: DemoService; state: State; actorId: string; setActor: (id: string) => void; run: (c: Command) => Result<string>; ready: boolean; storageIssue: string; corrupt: boolean; reset: () => void; notice: string };
const Context = createContext<DemoContext | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() => createSeed());
  const [actorId, setActorId] = useState("customer");
  const [ready, setReady] = useState(false);
  const [storageIssue, setStorageIssue] = useState("");
  const [corrupt, setCorrupt] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    queueMicrotask(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const result = demoStorageSchema.safeParse(JSON.parse(raw));
        if (!result.success) throw new Error("incompatible");
        const parsed = result.data;
        new DemoService(parsed.state, parsed.actorId).expireReservations();
        setState(parsed.state); setActorId(parsed.actorId);
      }
    } catch (error) {
      if (error instanceof SyntaxError || (error instanceof Error && error.message === "incompatible")) { setCorrupt(true); setStorageIssue("Data lokal tidak kompatibel atau rusak. Reset untuk melanjutkan."); }
      else setStorageIssue("Penyimpanan browser tidak tersedia. Perubahan hanya bertahan selama sesi ini.");
    }
    setReady(true);
    });
  }, []);
  useEffect(() => {
    if (!ready || corrupt) return;
    const timer = setInterval(() => {
      const next = structuredClone(state);
      new DemoService(next, actorId).expireReservations();
      if (next.audit.length === state.audit.length) return;
      setState(next);
      try { localStorage.setItem(key, JSON.stringify({ state: next, actorId })); }
      catch { setStorageIssue("Penyimpanan browser tidak tersedia. Perubahan hanya bertahan selama sesi ini."); }
    }, 1000);
    return () => clearInterval(timer);
  }, [state, actorId, ready, corrupt]);
  const persist = (next: State, actor: string) => {
    if (corrupt) return;
    try { localStorage.setItem(key, JSON.stringify({ state: next, actorId: actor })); }
    catch { setStorageIssue("Penyimpanan browser tidak tersedia. Perubahan hanya bertahan selama sesi ini."); }
  };
  const service = new DemoService(state, actorId);
  const run = (command: Command) => {
    if (corrupt) { const result: Result<string> = { ok: false, code: "INVALID_STATE", message: "Reset data lokal sebelum melanjutkan." }; setNotice(result.message); return result; }
    const next = structuredClone(state);
    const result = new DemoService(next, actorId).execute(command, `demo-${crypto.randomUUID()}`);
    setState(next); persist(next, actorId);
    setNotice(result.ok ? "Perubahan tersimpan." : result.message);
    return result;
  };
  const reset = () => {
    const next = createSeed();
    setState(next); setActorId("customer"); setCorrupt(false); setStorageIssue(""); setNotice("Data lokal direset.");
    try {
      localStorage.setItem(key, JSON.stringify({ state: next, actorId: "customer" }));
      for (const member of next.members) sessionStorage.removeItem(`beetip-draft-${member.id}`);
    } catch { setStorageIssue("Penyimpanan browser tidak tersedia."); }
  };
  return <Context.Provider value={{ state, service, actorId, setActor: id => { setActorId(id); persist(state, id); setNotice(""); }, run, ready, corrupt, storageIssue, reset, notice }}>{children}</Context.Provider>;
}
export function useDemo() { const context = useContext(Context); if (!context) throw new Error("DemoProvider required"); return context; }
