/**
 * Declarative Tooling Manifest Bridge
 * Resolves repository build, test, and verification tooling.
 * Supports explicit configuration via .prsquad/config.json with zero-config
 * automatic fallback detection across major ecosystems (Maven, Gradle, npm, Pytest, Cargo, Go, .NET).
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getRepoRoot } from "./stateStore.js";

export interface ToolingConfig {
  stack: string;
  testCommand: string;
  testFileCommand?: string;
  buildCommand?: string;
  lintCommand?: string;
  isExplicitConfig: boolean;
}

export const SUPPORTED_STACKS = [
  "npm",
  "maven",
  "gradle",
  "pytest",
  "cargo",
  "go",
  "dotnet",
  "unknown"
] as const;

/**
 * Detects the repository's stack by inspecting project marker files.
 */
export function detectRepoStack(rootDir: string = getRepoRoot()): ToolingConfig {
  // 1. Explicit configuration: .prsquad/config.json or .prsquad.json
  const explicitPaths = [
    join(rootDir, ".prsquad", "config.json"),
    join(rootDir, ".prsquad.json"),
  ];

  for (const configPath of explicitPaths) {
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed.tooling && parsed.tooling.testCommand) {
          return {
            stack: parsed.stack || "custom",
            testCommand: parsed.tooling.testCommand,
            testFileCommand: parsed.tooling.testFileCommand,
            buildCommand: parsed.tooling.buildCommand,
            lintCommand: parsed.tooling.lintCommand,
            isExplicitConfig: true,
          };
        }
      } catch {}
    }
  }

  // 2. Zero-config automatic fallback detection based on project markers

  // Maven (Java)
  if (existsSync(join(rootDir, "pom.xml"))) {
    return {
      stack: "maven",
      testCommand: "mvn test",
      testFileCommand: "mvn test -Dtest=${file}",
      buildCommand: "mvn compile -DskipTests",
      lintCommand: "mvn spotbugs:check",
      isExplicitConfig: false,
    };
  }

  // Gradle (Java / Kotlin)
  if (existsSync(join(rootDir, "build.gradle")) || existsSync(join(rootDir, "build.gradle.kts"))) {
    const gradleCmd = existsSync(join(rootDir, "gradlew")) ? "./gradlew" : "gradle";
    return {
      stack: "gradle",
      testCommand: `${gradleCmd} test`,
      testFileCommand: `${gradleCmd} test --tests ${"${file}"}`,
      buildCommand: `${gradleCmd} assemble`,
      lintCommand: `${gradleCmd} check`,
      isExplicitConfig: false,
    };
  }

  // Node.js (npm / pnpm / yarn)
  if (existsSync(join(rootDir, "package.json"))) {
    let runner = "npm test";
    if (existsSync(join(rootDir, "pnpm-lock.yaml"))) {
      runner = "pnpm test";
    } else if (existsSync(join(rootDir, "yarn.lock"))) {
      runner = "yarn test";
    }
    return {
      stack: "npm",
      testCommand: runner,
      testFileCommand: `${runner} -- \${file}`,
      buildCommand: "npm run build",
      lintCommand: "npm run lint",
      isExplicitConfig: false,
    };
  }

  // Python (pytest / unittest)
  if (
    existsSync(join(rootDir, "pytest.ini")) ||
    existsSync(join(rootDir, "pyproject.toml")) ||
    existsSync(join(rootDir, "requirements.txt"))
  ) {
    return {
      stack: "pytest",
      testCommand: "pytest",
      testFileCommand: "pytest ${file}",
      lintCommand: "flake8 .",
      isExplicitConfig: false,
    };
  }

  // Rust (Cargo)
  if (existsSync(join(rootDir, "Cargo.toml"))) {
    return {
      stack: "cargo",
      testCommand: "cargo test",
      testFileCommand: "cargo test --test ${file}",
      buildCommand: "cargo build",
      lintCommand: "cargo clippy",
      isExplicitConfig: false,
    };
  }

  // Go
  if (existsSync(join(rootDir, "go.mod"))) {
    return {
      stack: "go",
      testCommand: "go test ./...",
      testFileCommand: "go test -v ${file}",
      buildCommand: "go build ./...",
      lintCommand: "golangci-lint run",
      isExplicitConfig: false,
    };
  }

  // .NET (C# / F#)
  try {
    const entries = readdirSync(rootDir);
    if (entries.some((f) => f.endsWith(".sln") || f.endsWith(".csproj") || f.endsWith(".fsproj"))) {
      return {
        stack: "dotnet",
        testCommand: "dotnet test",
        testFileCommand: "dotnet test --filter ${file}",
        buildCommand: "dotnet build",
        isExplicitConfig: false,
      };
    }
  } catch {}

  // Default fallback (generic npm runner)
  return {
    stack: "unknown",
    testCommand: "npm test",
    isExplicitConfig: false,
  };
}

/**
 * Checks whether a command is a permitted test command for QA based on the repository's stack.
 * Strictly verifies test runner subcommands and rejects arbitrary package commands (e.g. npm publish, npm install).
 */
export function isCommandAllowedByTooling(command: string, config: ToolingConfig): boolean {
  const trimmed = command.trim();
  const tokens = trimmed.split(/\s+/);

  // 1. Exact match with configured test command
  if (trimmed === config.testCommand) return true;

  // 2. Allow configured test command with arguments (e.g. "npm test -- tests/auth.test.ts")
  if (trimmed.startsWith(config.testCommand + " ") || trimmed.startsWith(config.testCommand + "=")) {
    return true;
  }

  // 3. Allow configured build or lint command
  if (config.buildCommand && (trimmed === config.buildCommand || trimmed.startsWith(config.buildCommand + " "))) {
    return true;
  }
  if (config.lintCommand && (trimmed === config.lintCommand || trimmed.startsWith(config.lintCommand + " "))) {
    return true;
  }

  // 3. Allow recognized test runner patterns for the stack
  if (config.stack === "npm" || config.stack === "typescript" || config.stack === "node") {
    if (tokens[0] === "npm" && (tokens[1] === "test" || tokens[1] === "t" || (tokens[1] === "run" && tokens[2]?.startsWith("test")))) {
      return true;
    }
    if (tokens[0] === "pnpm" && (tokens[1] === "test" || tokens[1] === "t" || (tokens[1] === "run" && tokens[2]?.startsWith("test")))) {
      return true;
    }
    if (tokens[0] === "yarn" && (tokens[1] === "test" || (tokens[1] === "run" && tokens[2]?.startsWith("test")))) {
      return true;
    }
    return false;
  }

  if (config.stack === "maven") {
    return tokens[0] === "mvn" && tokens.includes("test");
  }

  if (config.stack === "gradle") {
    return (tokens[0] === "gradle" || tokens[0] === "./gradlew") && tokens.includes("test");
  }

  if (config.stack === "pytest") {
    return tokens[0] === "pytest" || (tokens[0].startsWith("python") && tokens.includes("pytest"));
  }

  if (config.stack === "cargo") {
    return tokens[0] === "cargo" && tokens[1] === "test";
  }

  if (config.stack === "go") {
    return tokens[0] === "go" && tokens[1] === "test";
  }

  if (config.stack === "dotnet") {
    return tokens[0] === "dotnet" && tokens[1] === "test";
  }

  return false;
}
