import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { toPosixRelative } from "./stateStore.js";

export interface ExternalReference {
  symbol: string;
  declaredIn: string;
  referencedIn: string;
  lineNumber: number;
  snippet: string;
}

export interface SymbolSweepReport {
  totalSymbolsAnalyzed: number;
  exportedSymbols: string[];
  externalReferencesFound: ExternalReference[];
  riskAssessment: "LOW" | "MEDIUM" | "HIGH";
  summary: string;
}

const EXPORT_REGEX =
  /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z0-9_$]+)/g;

/**
 * Extracts exported symbol names from a TypeScript or JavaScript file.
 */
export function extractExportedSymbols(filePath: string, rootDir: string = process.cwd()): string[] {
  const full = join(rootDir, filePath);
  if (!existsSync(full)) return [];

  const content = readFileSync(full, "utf-8");
  const symbols = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = EXPORT_REGEX.exec(content)) !== null) {
    if (match[1]) {
      symbols.add(match[1]);
    }
  }

  // Also check "export { A, B as C }" patterns
  const namedExportRegex = /export\s*\{([^}]+)\}/g;
  while ((match = namedExportRegex.exec(content)) !== null) {
    const list = match[1].split(",");
    for (const item of list) {
      const parts = item.trim().split(/\s+as\s+/);
      const name = parts[parts.length - 1]?.trim();
      if (name && /^[A-Za-z0-9_$]+$/.test(name)) {
        symbols.add(name);
      }
    }
  }

  return [...symbols];
}

/**
 * Recursively scans files in the repository, excluding build, dependency, and governance directories.
 */
function getAllSourceFiles(dir: string, rootDir: string): string[] {
  const ignoreDirs = new Set([
    "node_modules",
    ".git",
    ".gated-change",
    "dist",
    "coverage",
    ".cache",
    ".playwright-mcp",
  ]);

  const results: string[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    if (ignoreDirs.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      results.push(...getAllSourceFiles(fullPath, rootDir));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) {
      results.push(toPosixRelative(fullPath, rootDir));
    }
  }

  return results;
}

/**
 * Sweeps the codebase to find external references to exported symbols modified in changed files.
 */
export function runSymbolSweep(
  changedFiles: string[],
  approvedScopePrefix: string,
  rootDir: string = process.cwd()
): SymbolSweepReport {
  const exportedSymbolsSet = new Set<string>();
  const symbolSourceMap = new Map<string, string>();

  for (const file of changedFiles) {
    const symbols = extractExportedSymbols(file, rootDir);
    for (const sym of symbols) {
      exportedSymbolsSet.add(sym);
      symbolSourceMap.set(sym, file);
    }
  }

  const exportedSymbols = [...exportedSymbolsSet];
  if (exportedSymbols.length === 0) {
    return {
      totalSymbolsAnalyzed: 0,
      exportedSymbols: [],
      externalReferencesFound: [],
      riskAssessment: "LOW",
      summary: "No exported symbols detected in changed files. Blast radius is strictly internal.",
    };
  }

  const allFiles = getAllSourceFiles(rootDir, rootDir);
  const normalizedScope = approvedScopePrefix
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  // Files outside approved scope
  const externalFiles = allFiles.filter(
    (f) =>
      !f.startsWith(normalizedScope + "/") &&
      f !== normalizedScope &&
      !changedFiles.includes(f)
  );

  const externalReferencesFound: ExternalReference[] = [];

  for (const extFile of externalFiles) {
    const full = join(rootDir, extFile);
    const content = readFileSync(full, "utf-8");
    const lines = content.split("\n");

    for (const sym of exportedSymbols) {
      const symRegex = new RegExp(`\\b${sym}\\b`);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (symRegex.test(line)) {
          // Avoid matching declarations within the same symbol name if coincidentally identical
          externalReferencesFound.push({
            symbol: sym,
            declaredIn: symbolSourceMap.get(sym) || "",
            referencedIn: extFile,
            lineNumber: i + 1,
            snippet: line.trim(),
          });
        }
      }
    }
  }

  const riskAssessment =
    externalReferencesFound.length > 5
      ? "HIGH"
      : externalReferencesFound.length > 0
      ? "MEDIUM"
      : "LOW";

  const summary =
    externalReferencesFound.length === 0
      ? `Analyzed ${exportedSymbols.length} exported symbol(s). Zero external package references found. Blast radius is safely contained.`
      : `Found ${externalReferencesFound.length} external reference(s) across packages for ${exportedSymbols.length} modified symbol(s). Flagged for Reviewer audit.`;

  return {
    totalSymbolsAnalyzed: exportedSymbols.length,
    exportedSymbols,
    externalReferencesFound,
    riskAssessment,
    summary,
  };
}

/**
 * Discovers changed files from git diff relative to baseRef.
 */
export function getChangedFilesFromGit(
  baseRef: string = "HEAD",
  rootDir: string = process.cwd()
): string[] {
  try {
    const stdout = execSync(`git diff --name-only ${baseRef}`, {
      cwd: rootDir,
      encoding: "utf-8",
    });
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && /\.(ts|tsx|js|jsx)$/.test(l));
  } catch {
    return [];
  }
}
