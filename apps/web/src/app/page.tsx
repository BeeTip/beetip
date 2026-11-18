import { Board } from "../components/marketplace";
import { ConnectedBoard } from "../components/connected-listings";
import { mode } from "../server/identity/config";

export default function Page() { return mode() === "demo" ? <Board /> : <ConnectedBoard />; }
