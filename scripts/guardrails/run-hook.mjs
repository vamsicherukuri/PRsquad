#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const action = process.argv[2] || "hook-verify-gate";

// Fail-safe self-registration: If .gated-change exists in the active workspace,
// save the absolute path to the plugin root (parent of dist/) for non-hook CLI callers
try {
  const stateDir = resolve(process.cwd(), ".gated-change");
  if (existsSync(stateDir)) {
    const pluginRoot = resolve(__dirname, "..");
    writeFileSync(join(stateDir, "plugin-root.txt"), pluginRoot, "utf-8");
  }
} catch {}

const candidates = [
  resolve(__dirname, `${action}.mjs`),
  resolve(process.cwd(), "plugins/gated-change/dist", `${action}.mjs`),
  resolve(process.cwd(), "dist", `${action}.mjs`),
];

const target = candidates.find((p) => existsSync(p));
if (!target) {
  process.stderr.write(`[PRSquad Hook Error] Could not resolve hook '${action}'\n`);
  process.exit(1);
}

// Rewire process.argv so the target script sees its expected arguments
process.argv = [process.argv[0], target, ...process.argv.slice(3)];

await import(`file://${target.replace(/\\/g, "/")}`);
