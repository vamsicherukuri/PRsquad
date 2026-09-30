#!/usr/bin/env node
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const title = "Scoped read tool fails to match multi-path declared scopes separated by semicolons";

const body = `Scope: src/scopeTool.ts, scripts/test-guardrails.ts

Problem:
\`isWithinScope\` in \`src/scopeTool.ts\` treats \`declaredScope\` as a single literal string path prefix. When an issue or configuration specifies multiple approved paths separated by semicolons or commas (e.g. \`src/scopeTool.ts; scripts/test-guardrails.ts\`), \`isWithinScope\` normalizes the entire unsplit string, so any read request against an individual in-scope file (e.g. \`src/scopeTool.ts\`) falsely returns \`false\` and is blocked with \`BLOCKED: "src/scopeTool.ts" is outside the declared scope\`.

Reproduction:
Call \`isWithinScope("src/scopeTool.ts", "src/scopeTool.ts; scripts/test-guardrails.ts", process.cwd())\`.
Expected: Returns \`true\`.
Actual: Returns \`false\`.

Acceptance Criteria:
1. \`isWithinScope\` splits \`declaredScope\` by semicolon (\`;\`) and comma (\`,\`), trimming whitespace and normalizing each entry.
2. Returns \`true\` if the requested file path matches or is nested under any single entry in a multi-path declaration.
3. Strictly retains read-boundary containment for paths outside all declared entries.
4. Includes automated regression test coverage in \`scripts/test-guardrails.ts\`.
`;

const tempFile = join(tmpdir(), `create-issue-${Date.now()}.md`);
writeFileSync(tempFile, body, "utf-8");

try {
  const out = execFileSync(
    "gh",
    [
      "issue",
      "create",
      "--repo",
      "vamsicherukuri/gated-fix-pipeline",
      "--title",
      title,
      "--body-file",
      tempFile,
    ],
    { encoding: "utf-8" }
  );
  console.log("SUCCESS:", out.trim());
} catch (err: any) {
  console.error("ERROR:", err.message, err.stderr?.toString());
} finally {
  try {
    unlinkSync(tempFile);
  } catch {}
}
