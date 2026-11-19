export function connectedOrderState(state: string) {
  return ({ awaiting_payment: "Menunggu pembayaran", awaiting_top_up: "Menunggu tambahan dana", expired: "Reservasi kedaluwarsa", cancelled: "Dibatalkan", funding_verified: "Dana telah diverifikasi",
    purchasing: "Sedang dibelanjakan", purchased: "Semua barang dibeli", purchase_partial: "Sebagian barang dibeli", purchase_unavailable: "Barang tidak tersedia",
    delivering: "Dalam perjalanan", delivery_confirmed: "Diterima" })[state] ?? "Status belum tersedia";
}
