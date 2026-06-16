import { basename, resolve } from "node:path";
import type {
  Finding,
  ClaudeSession,
  ClaudePrompt,
  PromptTrace,
} from "../types.js";

interface Correlation {
  trace: PromptTrace;
  fix: string[];
}

export function correlateFindings(
  findings: Finding[],
  sessions: ClaudeSession[],
  repoPath: string
): void {
  for (const finding of findings) {
    if (finding.trace || finding.manual) continue;

    const correlation = findCorrelation(finding, sessions, repoPath);
    if (correlation) {
      finding.trace = correlation.trace;
      finding.fix = correlation.fix;
    } else if (!finding.manual) {
      finding.manual = guessManualNote(finding);
    }
  }
}

function findCorrelation(
  finding: Finding,
  sessions: ClaudeSession[],
  repoPath: string
): Correlation | null {
  const findingPath = extractFilePath(finding.path);
  if (!findingPath) return null;

  const findingBase = basename(findingPath);
  // For migration files, extract the name portion without timestamp prefix and .sql extension
  // e.g. "001_hexagon_system.sql" → "hexagon_system", "20260520_cleanup.sql" → "cleanup"
  const findingMigrationName = findingBase.replace(/^\d+_/, "").replace(/\.sql$/, "").toLowerCase();

  for (const session of sessions) {
    for (const prompt of session.prompts) {
      const matchedFile = prompt.filesGenerated.find((f) => {
        const resolved = f.startsWith("/") ? f : resolve(repoPath, f);
        const resolvedBase = basename(resolved);

        // Exact path match
        if (
          resolved.endsWith(findingPath) ||
          f === findingPath ||
          f.endsWith(findingPath)
        ) {
          return true;
        }

        // Basename match
        if (resolvedBase === findingBase) return true;

        // Migration fuzzy match: apply_migration stores partial names like
        // "supabase/migrations/cleanup_cycling_taxonomy" which need to match
        // "supabase/migrations/20260520223550_cleanup_cycling_taxonomy.sql"
        if (findingPath.includes("supabase/migrations/") && f.includes("supabase/migrations/")) {
          const genName = basename(f).replace(/^\d+_/, "").replace(/\.sql$/, "").toLowerCase();
          if (genName && findingMigrationName && genName === findingMigrationName) return true;
          // Also match if one contains the other (partial name from apply_migration)
          if (genName && findingMigrationName) {
            if (genName.includes(findingMigrationName) || findingMigrationName.includes(genName)) {
              return true;
            }
          }
        }

        return false;
      });

      if (matchedFile) {
        const trace = buildTrace(finding, prompt, session, matchedFile);
        const fix = generateFix(finding, prompt);
        return { trace, fix };
      }
    }
  }

  return null;
}

function extractFilePath(path: string): string | null {
  // "git history · commit abc1234" → no file path for correlation
  if (path.startsWith("git history")) return null;
  if (path.startsWith("database ·")) return null;
  if (path.startsWith("package.json")) return null;

  // "supabase/migrations/0007_orgs.sql" or "app/api/upload/route.ts"
  return path;
}

function buildTrace(
  finding: Finding,
  prompt: ClaudePrompt,
  session: ClaudeSession,
  matchedFile: string
): PromptTrace {
  const ts = formatTimestamp(prompt.timestamp || session.timestamp);
  const lineCount = estimateLineCount(prompt, matchedFile);

  return {
    prompt: `"${truncate(prompt.text, 120)}"`,
    session: `${ts} · claude code`,
    file: `${matchedFile}${lineCount ? ` (+${lineCount} lines)` : ""}`,
    result: inferResult(finding),
  };
}

function inferResult(finding: Finding): string {
  const title = finding.title.toLowerCase();
  const meta = finding.meta.toLowerCase();

  if (title.includes("rls") || title.includes("row level security")) {
    return "RLS was never enabled — the prompt asked for the schema, not the access rules.";
  }
  if (title.includes("validation") || title.includes("upload")) {
    return "No validation generated. The prompt never mentioned constraints, so none were added.";
  }
  if (title.includes("injection") || title.includes("interpolat")) {
    return "Raw query params concatenated into the query. No parameterization requested.";
  }
  if (title.includes("webhook") || title.includes("signature")) {
    return "Handler trusts the payload directly. Signature verification was never requested.";
  }
  if (title.includes("xss") || title.includes("cross-site")) {
    return "User input rendered without sanitization. The prompt didn't mention output encoding.";
  }
  if (meta.includes("auth") || title.includes("auth")) {
    return "No authentication check generated. The prompt didn't specify access control.";
  }
  if (title.includes("service-role") || title.includes("service_role")) {
    return "The service-role client was placed in a client-accessible module. The prompt didn't specify server-only.";
  }

  return `The prompt produced this code without the security constraint. The omission led to ${finding.title.toLowerCase()}.`;
}

function generateFix(finding: Finding, prompt: ClaudePrompt): string[] {
  const originalPrompt = prompt.text.toLowerCase();
  const title = finding.title.toLowerCase();

  if (title.includes("rls") || title.includes("row level security")) {
    return [
      `"${truncate(prompt.text, 80)}.`,
      `Enable row level security and add a policy so a user can only select rows`,
      `for their own records. Deny anon access by default."`,
    ];
  }

  if (title.includes("upload") || title.includes("validation")) {
    return [
      `"${truncate(prompt.text, 80)}.`,
      `Validate MIME type (images only), cap size at 5MB, sanitize the filename`,
      `against path traversal, require an authenticated session, and enforce an`,
      `RLS policy so a user can only write to their own folder."`,
    ];
  }

  if (title.includes("injection") || title.includes("interpolat")) {
    return [
      `"${truncate(prompt.text, 80)}.`,
      `Validate the params as ISO dates and use parameterized Supabase filters —`,
      `never string-concatenate user input into the query."`,
    ];
  }

  if (title.includes("webhook") || title.includes("signature")) {
    return [
      `"${truncate(prompt.text, 80)}.`,
      `Verify the Stripe-Signature header against the webhook secret and reject`,
      `any event that fails verification."`,
    ];
  }

  if (title.includes("xss") || title.includes("cross-site")) {
    return [
      `"${truncate(prompt.text, 80)}.`,
      `Sanitize all user-provided content before rendering. Use proper encoding`,
      `and never set innerHTML with unescaped user data."`,
    ];
  }

  if (title.includes("auth") && !title.includes("webhook")) {
    return [
      `"${truncate(prompt.text, 80)}.`,
      `Add authentication middleware that verifies the session token before`,
      `processing the request. Reject unauthenticated requests with 401."`,
    ];
  }

  // Generic fallback fix
  return [
    `"${truncate(prompt.text, 80)}.`,
    `Add security constraints: validate inputs, enforce authentication,`,
    `and follow least-privilege defaults."`,
  ];
}

function formatTimestamp(ts: string): string {
  if (!ts) return "unknown date";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toISOString().replace("T", " ").slice(0, 16);
  } catch {
    return ts;
  }
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\n/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1) + "…";
}

function estimateLineCount(
  prompt: ClaudePrompt,
  matchedFile: string
): number | null {
  for (const tc of prompt.toolCalls) {
    if (tc.filePath && tc.filePath.endsWith(basename(matchedFile))) {
      if (tc.content) {
        return tc.content.split("\n").length;
      }
    }
  }
  return null;
}

function guessManualNote(finding: Finding): string | null {
  if (finding.source === "gitleaks") {
    return "Not a generation issue — a leaked credential. Rotate the key in the relevant service, then purge it from git history. No prompt rewrite applies.";
  }
  if (finding.source === "deps") {
    return "Not a generation issue — a vulnerable dependency. Update or replace the package. No prompt rewrite applies.";
  }
  if (finding.title.toLowerCase().includes("service-role")) {
    return "Move the service-role client to a server-only module. Architectural fix, not a prompt rewrite.";
  }
  return null;
}
