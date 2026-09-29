import { readFileSync, existsSync } from "node:fs";
import { relative, isAbsolute, join } from "node:path";
import { defineTool, type Tool } from "@github/copilot-sdk";

/**
 * implementation-plan.md §5b/§6: scope containment must be an ENFORCED tool-level boundary, not a
 * prompt instruction the model might ignore. This is a deliberately small, working example of that
 * enforcement pattern - a real repo/production build would extend it with the "one hop of
 * importers/callers" search described in the Architect agent's system prompt, and a parallel
 * scoped-write tool for the Developer agent (out of scope for this narrow slice - see README.md).
 */
export function isWithinScope(path: string, declaredScope: string, root: string): boolean {
  const rel = isAbsolute(path) ? relative(root, path) : path;
  const normalizedScope = declaredScope.replace(/^\/+/, "").replace(/\/+$/, "");
  return rel === normalizedScope || rel.startsWith(`${normalizedScope}/`);
}

export function makeScopedReadTool(declaredScope: string, root: string): Tool<{ path: string }> {
  return defineTool<{ path: string }>("read_scoped_file", {
    description:
      `Read a file's contents. Only files under the declared scope ("${declaredScope}") are readable - ` +
      "a request for any other path is refused, not silently redirected.",
    // Raw JSON schema, deliberately not a zod schema: the SDK's ZodSchema interface expects a
    // toJSONSchema() instance method that zod v3 doesn't provide (that's a zod v4 addition, and
    // even there it's a top-level z.toJSONSchema() helper, not an instance method) - a plain JSON
    // schema object avoids depending on either the exact zod major version or an adapter.
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repo-relative file path to read" },
      },
      required: ["path"],
    },
    handler: async ({ path }) => {
      if (!isWithinScope(path, declaredScope, root)) {
        return {
          error: `BLOCKED: "${path}" is outside the declared scope "${declaredScope}". ` +
            "If this file is genuinely needed to complete the plan, say so explicitly in your " +
            "response instead of retrying the read - that becomes a scope-amendment question for " +
            "a human, per implementation-plan.md §5b, not something this tool will grant.",
        };
      }
      const full = join(root, path);
      if (!existsSync(full)) {
        return { error: `"${path}" does not exist.` };
      }
      return { path, content: readFileSync(full, "utf-8") };
    },
  });
}
