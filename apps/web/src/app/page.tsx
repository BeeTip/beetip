import { Board } from "../components/marketplace";
import { PublicCatalog } from "../components/public-catalog";
import { sampleListings } from "../server/catalog";
import { mode } from "../server/identity/config";

export default function Page() { return mode() === "demo" ? <Board /> : <PublicCatalog listings={sampleListings} />; }
