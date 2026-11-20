import "server-only";
import { identityConfig, mode } from "./config";

export function syntheticTransfersEnabled() {
  if (mode() !== "connected" || process.env.BEETIP_SYNTHETIC_TRANSFERS !== "1") return false;
  try {
    const { url, origin } = identityConfig();
    return [url, origin].every(value => new URL(value).hostname === "127.0.0.1");
  } catch {
    return false;
  }
}
