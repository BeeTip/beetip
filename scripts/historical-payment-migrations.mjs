import { readdirSync } from "node:fs";

export function historicalPaymentMigrations(directory) {
  return readdirSync(directory).filter(file => file.endsWith(".sql") && file < "20261121004000").sort();
}
