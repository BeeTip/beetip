"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <div className="empty"><h1>Halaman belum dapat dimuat</h1><p>Data demo tetap tersimpan jika penyimpanan browser tersedia.</p><button className="button button-primary" onClick={reset}>Coba lagi</button></div>; }
