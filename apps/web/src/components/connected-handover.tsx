"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { handoverCodePattern, issuedHandoverSchema, type HandoverCommand } from "@beetip/validation";
import { Button } from "./ui";

const handoverLifetimeMs = 60_000;
type Challenge = { code: string; displayUntil: number; qr?: string };
type Camera = { stream?: MediaStream; stop?: () => void };
const closeCamera = (camera?: Camera) => {
  camera?.stop?.();
  camera?.stream?.getTracks().forEach(track => track.stop());
};

export function ConnectedHandover({ orderId, memberId, orderState, provider, onChange }: {
  orderId: string; memberId: string; orderState: string; provider: boolean; onChange: () => void;
}) {
  const [challenge, setChallenge] = useState<Challenge>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState<"delivering" | "delivery_confirmed">();
  const request = useRef<AbortController | undefined>(undefined);
  const camera = useRef<Camera | undefined>(undefined);
  const video = useRef<HTMLVideoElement>(null);
  const state = orderState === "delivery_confirmed" || advanced === "delivery_confirmed" ? "delivery_confirmed" : advanced ?? orderState;

  useEffect(() => () => {
    request.current?.abort();
    const active = camera.current;
    camera.current = undefined;
    closeCamera(active);
  }, []);
  useEffect(() => {
    if (!challenge) return;
    const timer = setTimeout(() => {
      setChallenge(undefined);
      setNotice("Kode sudah berakhir. Buat kode baru untuk melanjutkan.");
    }, Math.max(0, challenge.displayUntil - performance.now()));
    return () => clearTimeout(timer);
  }, [challenge]);

  function stopCamera() {
    const active = camera.current;
    camera.current = undefined;
    closeCamera(active);
    setScanning(false);
  }

  async function send(command: HandoverCommand) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    const displayUntil = performance.now() + handoverLifetimeMs;
    if (command.action === "issue") setChallenge(undefined);
    if (command.action === "confirm") stopCamera();
    try {
      const response = await fetch("/api/identity/handover", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Beetip-Member": memberId },
        body: JSON.stringify(command),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (result.code === "replayed") { setAdvanced("delivery_confirmed"); onChange(); return; }
        setError(result.message ?? "Serah terima belum dapat diproses.");
        if (command.action === "start") onChange();
        return;
      }
      if (result.ok !== true) throw new Error();
      if (command.action === "issue") {
        const issued = issuedHandoverSchema.parse({ code: result.code, expiresAt: result.expiresAt });
        const qr = await import("qrcode").then(({ default: encoder }) => encoder.toDataURL(
          JSON.stringify({ orderId, code: issued.code }), { width: 220, margin: 4 },
        )).catch(() => undefined);
        if (controller.signal.aborted) return;
        if (displayUntil > performance.now()) {
          setChallenge({ code: issued.code, displayUntil, qr });
          setNotice("Kode siap ditampilkan.");
        } else setNotice("Kode sudah berakhir. Buat kode baru untuk melanjutkan.");
        return;
      }
      setAdvanced(command.action === "start" ? "delivering" : "delivery_confirmed");
      onChange();
    } catch {
      if (!controller.signal.aborted) {
        setError("Hasil belum dapat dipastikan. Perbarui status sebelum mencoba lagi.");
        onChange();
      }
    } finally {
      request.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function scan() {
    if (camera.current || request.current) return;
    const element = video.current;
    if (!element || !navigator.mediaDevices?.getUserMedia) {
      setError("Kamera tidak tersedia. Masukkan kode cadangan.");
      return;
    }
    const active: Camera = {};
    camera.current = active;
    setError("");
    setScanning(true);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      if (camera.current !== active) return;
      active.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (camera.current !== active) { closeCamera(active); return; }
      const controls = await new BrowserQRCodeReader().decodeFromStream(active.stream, element, (result, _, controls) => {
        if (!result || camera.current !== active) return;
        active.stop = () => controls.stop();
        stopCamera();
        try {
          const payload = JSON.parse(result.getText());
          if (payload.orderId !== orderId || typeof payload.code !== "string" || !handoverCodePattern.test(payload.code)) throw new Error();
          void send({ action: "confirm", orderId, code: payload.code });
        } catch { setError("QR tidak cocok dengan pesanan ini. Pindai ulang atau masukkan kode cadangan."); }
      });
      if (camera.current === active) active.stop = () => controls.stop();
      else controls.stop();
    } catch {
      if (camera.current === active) {
        stopCamera();
        setError("Kamera gagal dibuka. Periksa izin atau masukkan kode cadangan.");
      }
    }
  }

  return <section className="stack" aria-label="Serah terima pesanan">
    <h2>Serah terima pesanan</h2>
    {state === "delivery_confirmed" ? <p role="status">Serah terima dikonfirmasi.</p> : <>
      <p>Konfirmasi ini mencatat penerimaan barang. Dana simulasi tetap mengikuti proses terpisah.</p>
      {state !== "delivering" ? <Button type="button" disabled={busy} onClick={() => void send({ action: "start", orderId })}>Mulai pengantaran</Button> : provider ?
        <>
          <form className="stack" autoComplete="off" onSubmit={event => {
            event.preventDefault();
            const form = event.currentTarget;
            const code = String(new FormData(form).get("code") ?? "");
            form.reset();
            void send({ action: "confirm", orderId, code });
          }}>
            <label>Kode serah terima<input name="code" type="text" required maxLength={32} autoCapitalize="characters"
              spellCheck={false} autoComplete="off" aria-describedby="handover-code-help" /></label>
            <p id="handover-code-help">Masukkan 12 karakter yang ditunjukkan pelanggan. Lima percobaan gagal memerlukan kode baru.</p>
            <Button type="submit" disabled={busy}>Konfirmasi serah terima</Button>
          </form>
          <video ref={video} muted playsInline hidden={!scanning} aria-label="Pratinjau pemindai QR" />
          <div className="actions">
            {scanning ? <Button type="button" variant="secondary" onClick={stopCamera}>Hentikan kamera</Button> :
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void scan()}>Pindai QR</Button>}
          </div>
        </> : <>
          <form className="stack" onSubmit={event => {
            event.preventDefault();
            if (new FormData(event.currentTarget).has("checked")) void send({ action: "issue", orderId, checked: true });
          }}>
            <label className="check-field"><input type="checkbox" name="checked" required />Saya sudah memeriksa jumlah dan kondisi barang</label>
            <Button type="submit" disabled={busy}>{challenge ? "Buat ulang kode" : "Buat kode serah terima"}</Button>
          </form>
          {challenge && <div className="qr-panel">
            {challenge.qr && <Image src={challenge.qr} width={220} height={220} alt="QR serah terima pesanan" unoptimized />}
            <p>Kode cadangan <strong>{challenge.code}</strong></p>
            <p>Tunjukkan kode kepada penyedia. Kode berlaku selama 60 detik sejak dibuat.</p>
          </div>}
        </>}
      {busy && <p role="status">Memproses serah terima...</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </>}
  </section>;
}
