import { basename, resolve } from "node:path";
import type {
  Finding,
  ClaudeSession,
  ClaudePrompt,
  PromptTrace,
} from "../types.js";

interface Correlation {
  trace: PromptTrace;
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
        const trace = buildTrace(finding, prompt, session, matchedFile, repoPath);
        return { trace };
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

function relativize(filePath: string, repoPath: string): string {
  const prefix = repoPath.endsWith("/") ? repoPath : repoPath + "/";
  if (filePath.startsWith(prefix)) return filePath.slice(prefix.length);
  return filePath;
}

function buildTrace(
  finding: Finding,
  prompt: ClaudePrompt,
  session: ClaudeSession,
  matchedFile: string,
  repoPath: string
): PromptTrace {
  const ts = formatTimestamp(prompt.timestamp || session.timestamp);
  const lineCount = estimateLineCount(prompt, matchedFile);
  const relFile = relativize(matchedFile, repoPath);

  return {
    prompt: `"${truncate(prompt.text, 120)}"`,
    session: `${ts} · claude code`,
    file: `${relFile}${lineCount ? ` (+${lineCount} lines)` : ""}`,
    result: inferResult(finding),
    missingConstraints: detectMissingConstraints(finding, prompt),
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
  if (
    title.includes("cipher") || title.includes("crypto") ||
    title.includes("gcm") || title.includes("decipher") ||
    title.includes("hash") || title.includes("hmac")
  ) {
    return "The cryptographic operation is missing a required security parameter. The prompt didn't specify the full crypto requirements.";
  }
  if (meta.includes("auth") || title.includes("auth")) {
    return "No authentication check generated. The prompt didn't specify access control.";
  }
  if (title.includes("service-role") || title.includes("service_role")) {
    return "The service-role client was placed in a client-accessible module. The prompt didn't specify server-only.";
  }

  return `The prompt produced this code without the security constraint. The omission led to ${finding.title.toLowerCase()}.`;
}

interface Concern {
  keywords: string[];
  label: string;
}

const CONCERN_MAP: Record<string, Concern[]> = {
  crypto: [
    { keywords: ["auth tag", "authentication tag", "gcm tag", "tag verification", "verify tag"], label: "No mention of auth tag verification for GCM mode" },
    { keywords: ["key derivation", "kdf", "pbkdf", "scrypt", "argon"], label: "No mention of key derivation function" },
    { keywords: ["tamper", "integrity", "reject ciphertext", "verify integrity"], label: "No mention of tampered ciphertext rejection" },
    { keywords: ["iv", "nonce", "initialization vector", "random iv"], label: "No mention of IV/nonce management" },
  ],
  rls: [
    { keywords: ["rls", "row level security", "enable rls"], label: "No mention of Row Level Security" },
    { keywords: ["policy", "policies", "access policy"], label: "No mention of access policy definition" },
    { keywords: ["anon", "anonymous", "deny anon", "block anon"], label: "No mention of denying anonymous access" },
  ],
  injection: [
    { keywords: ["parameterized", "prepared statement", "bind param", "placeholder"], label: "No mention of parameterized queries" },
    { keywords: ["validate input", "input validation", "sanitize input"], label: "No mention of input validation" },
  ],
  webhook: [
    { keywords: ["signature", "verify signature", "stripe-signature", "webhook secret"], label: "No mention of signature verification" },
    { keywords: ["replay", "idempotency", "idempotent"], label: "No mention of replay protection" },
  ],
  xss: [
    { keywords: ["sanitize", "sanitization", "escape", "encoding", "encode"], label: "No mention of output sanitization/encoding" },
    { keywords: ["csp", "content-security-policy", "content security"], label: "No mention of Content Security Policy" },
    { keywords: ["innerhtml", "dangerouslysetinnerhtml", "raw html"], label: "No mention of avoiding raw HTML insertion" },
  ],
  auth: [
    { keywords: ["session", "token", "jwt", "verify token", "check session"], label: "No mention of session/token verification" },
    { keywords: ["access control", "authorization", "permission", "role"], label: "No mention of access control" },
    { keywords: ["401", "unauthorized", "reject unauthenticated"], label: "No mention of rejecting unauthenticated requests" },
  ],
  upload: [
    { keywords: ["mime", "file type", "content-type", "allowed types"], label: "No mention of MIME type validation" },
    { keywords: ["size limit", "max size", "file size", "cap size"], label: "No mention of file size limit" },
    { keywords: ["filename", "sanitize name", "path traversal"], label: "No mention of filename sanitization" },
  ],
};

function categorizeFinding(finding: Finding): string | null {
  const title = finding.title.toLowerCase();
  const meta = finding.meta.toLowerCase();

  if (title.includes("rls") || title.includes("row level security")) return "rls";
  if (title.includes("upload") || title.includes("validation")) return "upload";
  if (title.includes("injection") || title.includes("interpolat")) return "injection";
  if (title.includes("webhook") || title.includes("signature")) return "webhook";
  if (title.includes("xss") || title.includes("cross-site")) return "xss";
  if (
    title.includes("cipher") || title.includes("crypto") ||
    title.includes("gcm") || title.includes("decipher") ||
    title.includes("hash") || title.includes("hmac")
  ) return "crypto";
  if (meta.includes("auth") || title.includes("auth")) return "auth";

  return null;
}

function detectMissingConstraints(finding: Finding, prompt: ClaudePrompt): string[] {
  const category = categorizeFinding(finding);
  if (!category) return [];

  const concerns = CONCERN_MAP[category];
  if (!concerns) return [];

  const promptText = prompt.text.toLowerCase();
  const missing: string[] = [];

  for (const concern of concerns) {
    const mentioned = concern.keywords.some((kw) => promptText.includes(kw));
    if (!mentioned) {
      missing.push(concern.label);
    }
  }

  return missing;
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
