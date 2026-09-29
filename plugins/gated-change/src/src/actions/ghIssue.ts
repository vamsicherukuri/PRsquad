import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

/** Thin wrappers around `gh issue` - the Actions runner already has gh CLI + GITHUB_TOKEN wired up. */

export interface IssueContext {
  number: number;
  title: string;
  body: string;
  comments: { body: string }[];
}

export function fetchIssue(number: number): IssueContext {
  const raw = execFileSync(
    "gh",
    ["issue", "view", String(number), "--json", "number,title,body,comments"],
    { encoding: "utf-8" }
  );
  return JSON.parse(raw) as IssueContext;
}

export function postComment(number: number, body: string): void {
  execFileSync("gh", ["issue", "comment", String(number), "--body", body], {
    stdio: "inherit",
  });
}

export function addLabel(number: number, label: string): void {
  execFileSync("gh", ["issue", "edit", String(number), "--add-label", label], {
    stdio: "inherit",
  });
}

export function removeLabel(number: number, label: string): void {
  try {
    execFileSync("gh", ["issue", "edit", String(number), "--remove-label", label], {
      stdio: "inherit",
    });
  } catch {
    // Label may already be gone (e.g. removed by an earlier retry of this job) - not fatal.
  }
}

/** Writes a key=value pair to $GITHUB_OUTPUT so downstream jobs can read it via `needs.<job>.outputs.<key>`. */
export function setJobOutput(key: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    console.warn(`GITHUB_OUTPUT not set - would have written ${key}=${value}`);
    return;
  }
  // Multi-line-safe form (GitHub's documented delimiter pattern), since plan text can contain newlines.
  const delimiter = `ghadelim_${Math.random().toString(36).slice(2)}`;
  appendFileSync(outputFile, `${key}<<${delimiter}\n${value}\n${delimiter}\n`);
}
