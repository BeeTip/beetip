import "server-only";

export type SampleListing = {
  id: string;
  title: string;
  shop: string;
  category: "Minuman" | "Makanan" | "Belanja";
  area: string;
  fee: number;
  type: "request" | "trip";
  description: string;
};

export const sampleListings: readonly SampleListing[] = [
  { id: "contoh-kopi", title: "Titip kopi untuk teman belajar", shop: "Kedai kopi", category: "Minuman", area: "Alam Sutera", fee: 7000, type: "trip", description: "Contoh jasa titip minuman: pilih kopi favorit, tulis ukuran dan tingkat gula, lalu sepakati pengantaran bersama pembeli titipan." },
  { id: "contoh-makan-siang", title: "Minta dibelikan makan siang", shop: "Tempat makan sekitar kampus", category: "Makanan", area: "Kampus Alam Sutera", fee: 10000, type: "request", description: "Contoh permintaan dibelikan: tulis menu, jumlah porsi, dan batas belanja agar orang lain dapat membantu membelikan." },
  { id: "contoh-belanja", title: "Sekalian belanja kebutuhan harian", shop: "Supermarket", category: "Belanja", area: "Alam Sutera", fee: 12000, type: "trip", description: "Contoh jasa titip belanja: kumpulkan kebutuhan harian dalam satu titipan dan sepakati ongkos jasa sebelum mulai belanja." },
  { id: "contoh-roti", title: "Titip roti untuk sore hari", shop: "Toko roti", category: "Makanan", area: "Sekitar kampus", fee: 8000, type: "request", description: "Contoh permintaan dibelikan roti: sebutkan pilihan rasa dan alternatif jika stok habis, kemudian tentukan batas belanja." },
];

export function sampleListing(id: string) {
  return sampleListings.find(listing => listing.id === id);
}
