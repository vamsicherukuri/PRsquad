#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const hookName = process.argv[2] || "hook-verify-gate";
const candidates = [
  resolve(__dirname, `${hookName}.mjs`),
  resolve(process.cwd(), "plugins/gated-change/dist", `${hookName}.mjs`),
  resolve(process.cwd(), "dist", `${hookName}.mjs`),
];

const target = candidates.find((p) => existsSync(p));
if (!target) {
  process.stderr.write(`[PRSquad Hook Error] Could not resolve hook '${hookName}'\n`);
  process.exit(1);
}

await import(`file://${target.replace(/\\/g, "/")}`);
