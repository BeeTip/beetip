export function connectedOrderState(state: string) {
  return ({ awaiting_payment: "Menunggu pembayaran", awaiting_top_up: "Menunggu tambahan dana", expired: "Reservasi kedaluwarsa", cancelled: "Dibatalkan", funding_verified: "Dana telah diverifikasi" })[state] ?? "Status belum tersedia";
}
