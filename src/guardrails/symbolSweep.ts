import type ts from "typescript";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { toPosixRelative } from "./stateStore.js";

// Optional dynamic TypeScript loader for zero-dependency bundled runtime
let _cachedTs: any = undefined;
function getTsCompiler(): any {
  if (_cachedTs !== undefined) return _cachedTs;
  try {
    const req = createRequire(import.meta.url);
    _cachedTs = req("typescript");
  } catch {
    _cachedTs = null;
  }
  return _cachedTs;
}

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

/**
 * Extracts exported symbol names from a TypeScript or JavaScript file using the TypeScript Compiler AST.
 * Safely extracts named functions, classes, variables, types, interfaces, enums, re-exports,
 * and captures anonymous default exports (e.g. arrow functions, unnamed functions/classes) as 'default'.
 * Never throws an uncaught exception on malformed or unnamed expressions.
 */
export function extractExportedSymbols(filePath: string, rootDir: string = process.cwd()): string[] {
  const full = join(rootDir, filePath);
  if (!existsSync(full)) return [];

  const content = readFileSync(full, "utf-8");
  const symbols = new Set<string>();

  const ts = getTsCompiler();
  if (ts) {
    try {
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true
      );

    function visit(node: any) {
      const modifiers = (ts.canHaveModifiers && ts.canHaveModifiers(node)
        ? ts.getModifiers(node)
        : (node as any).modifiers) || [];

      const isExported = modifiers.some(
        (m: any) => m.kind === ts.SyntaxKind.ExportKeyword
      );
      const isDefault = modifiers.some(
        (m: any) => m.kind === ts.SyntaxKind.DefaultKeyword
      );

      if (isDefault) {
        symbols.add("default");
      }

      if (ts.isFunctionDeclaration(node)) {
        if (isExported) {
          if (node.name?.text) {
            symbols.add(node.name.text);
          } else if (isDefault) {
            symbols.add("default");
          }
        }
      } else if (ts.isClassDeclaration(node)) {
        if (isExported) {
          if (node.name?.text) {
            symbols.add(node.name.text);
          } else if (isDefault) {
            symbols.add("default");
          }
        }
      } else if (ts.isVariableStatement(node)) {
        if (isExported) {
          for (const decl of node.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              symbols.add(decl.name.text);
            } else if (ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name)) {
              for (const elem of decl.name.elements) {
                if (ts.isBindingElement(elem) && ts.isIdentifier(elem.name)) {
                  symbols.add(elem.name.text);
                }
              }
            }
          }
        }
      } else if (ts.isInterfaceDeclaration(node)) {
        if (isExported && node.name?.text) {
          symbols.add(node.name.text);
        }
      } else if (ts.isTypeAliasDeclaration(node)) {
        if (isExported && node.name?.text) {
          symbols.add(node.name.text);
        }
      } else if (ts.isEnumDeclaration(node)) {
        if (isExported && node.name?.text) {
          symbols.add(node.name.text);
        }
      } else if (ts.isExportDeclaration(node)) {
        // export { A, B as C }
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const elem of node.exportClause.elements) {
            const name = elem.name?.text;
            if (name) {
              symbols.add(name);
            }
          }
        }
      } else if (ts.isExportAssignment(node)) {
        // export default () => 42; or export default 42; or export = foo;
        if (!node.isExportEquals) {
          symbols.add("default");
        } else if (ts.isIdentifier(node.expression)) {
          symbols.add(node.expression.text);
        }
      }

      ts.forEachChild(node, visit);
    }

      visit(sourceFile);
      if (symbols.size > 0) {
        return [...symbols];
      }
    } catch {
      // Fall through to regex scanning
    }
  }

  // Graceful fallback to regex scanning if TypeScript is not available or AST threw
  const exportRegex =
    /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z0-9_$]+)/g;
  let match: RegExpExecArray | null;
  while ((match = exportRegex.exec(content)) !== null) {
    if (match[1]) symbols.add(match[1]);
  }
  if (/export\s+default\b/.test(content)) {
    symbols.add("default");
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
 * Deterministic Symbol & Reference Sweep:
 * 1. AST Symbol Extraction: Parses modified files using TypeScript AST (ts.createSourceFile)
 *    to discover exported functions, classes, variables, types, interfaces, and default exports.
 * 2. Cross-File Reference Sweep: Scans external repository source files for identifier occurrences
 *    to estimate cross-package blast radius and surface potential external call sites to Code Review.
 * Note: Performs deterministic lexical symbol occurrence sweeping across files (not a full semantic
 * type-checker reference graph).
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

  const scopePrefixes = approvedScopePrefix
    .split(/[,;]/)
    .map((s) => s.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, ""))
    .filter(Boolean);

  const allFiles = getAllSourceFiles(rootDir, rootDir);

  // Files outside approved scope
  const externalFiles = allFiles.filter((f) => {
    if (changedFiles.includes(f)) return false;
    const isInsideScope = scopePrefixes.some(
      (prefix) => f === prefix || f.startsWith(prefix + "/")
    );
    return !isInsideScope;
  });

  const externalReferencesFound: ExternalReference[] = [];

  for (const extFile of externalFiles) {
    const full = join(rootDir, extFile);
    const content = readFileSync(full, "utf-8");
    const lines = content.split("\n");

    for (const sym of exportedSymbols) {
      // Exclude language keyword 'default' from cross-file text sweeping to avoid false positives on switch statements or export clauses
      if (sym === "default") continue;

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

/**
 * Generates a deterministic AST pre-fetch map for files in declaredScope.
 * Analyzes exported functions/classes/types and discovers 1-hop external importers.
 */
export function generateAstPreFetchMap(
  declaredScope: string,
  rootDir: string = process.cwd()
): string {
  if (!declaredScope) return "";

  const files = declaredScope
    .split(/[;,]/)
    .map((s) => s.trim().replace(/\\/g, "/"))
    .filter((s) => s.length > 0);

  if (files.length === 0) return "";

  const allFiles = getAllSourceFiles(rootDir, rootDir);
  let out = `### 🧭 Deterministic AST Pre-Fetch & Symbol Map (0 AI Credits)\n\n`;
  out += `> **Pre-computed Code Structure:** The guardrail engine pre-indexed symbols and 1-hop callers across declared files. Use this structural map directly instead of broad search/view turns.\n\n`;

  const targetScopeFiles: Array<{
    file: string;
    symbols: Array<{ name: string; line: number; kind: string }>;
  }> = [];

  for (const relFile of files) {
    const full = join(rootDir, relFile);
    if (!existsSync(full) || !statSync(full).isFile()) continue;

    const content = readFileSync(full, "utf-8");
    const lines = content.split("\n");
    const fileSymbols: Array<{ name: string; line: number; kind: string }> = [];

    const lineExportRegex = /export\s+(?:default\s+)?(?:async\s+)?(function|class|const|let|var|type|interface|enum)\s+([A-Za-z0-9_$]+)/;
    for (let i = 0; i < lines.length; i++) {
      const match = lineExportRegex.exec(lines[i]);
      if (match && match[2]) {
        fileSymbols.push({
          kind: match[1],
          name: match[2],
          line: i + 1,
        });
      }
    }

    targetScopeFiles.push({ file: relFile, symbols: fileSymbols });
  }

  if (targetScopeFiles.length === 0) return "";

  out += `#### 📦 Target Scope Symbols\n\n`;
  for (const t of targetScopeFiles) {
    out += `- \`${t.file}\`\n`;
    if (t.symbols.length === 0) {
      out += `  - *(No top-level exports detected; test runner or script file)*\n`;
    } else {
      for (const s of t.symbols) {
        out += `  - \`${s.kind} ${s.name}\` (line ${s.line})\n`;
      }
    }
  }

  // Discover 1-hop importers
  const importersMap = new Map<string, Set<string>>();
  for (const t of targetScopeFiles) {
    for (const s of t.symbols) {
      const symRegex = new RegExp(`\\b${s.name}\\b`);
      for (const otherFile of allFiles) {
        if (otherFile === t.file || files.includes(otherFile)) continue;
        const fullOther = join(rootDir, otherFile);
        try {
          const c = readFileSync(fullOther, "utf-8");
          if (symRegex.test(c)) {
            if (!importersMap.has(otherFile)) {
              importersMap.set(otherFile, new Set());
            }
            importersMap.get(otherFile)!.add(s.name);
          }
        } catch {}
      }
    }
  }

  out += `\n#### 🔗 1-Hop Direct Callers / Importers\n\n`;
  if (importersMap.size === 0) {
    out += `> *(Zero external callers detected outside declared scope. Changes are safely isolated.)*\n`;
  } else {
    for (const [importer, syms] of importersMap.entries()) {
      out += `- \`${importer}\`: imports \`${[...syms].join("`, `")}\`\n`;
    }
  }

  return out;
}

