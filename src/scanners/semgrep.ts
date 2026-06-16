import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Finding } from "../types.js";
import { autoInstallSemgrep, type OnProgress } from "./installer.js";

const execFileAsync = promisify(execFile);

interface SemgrepResult {
  results: SemgrepMatch[];
  errors?: SemgrepError[];
}

interface SemgrepError {
  message?: string;
  long_msg?: string;
  type?: string;
  level?: string;
}

interface SemgrepMatch {
  check_id: string;
  path: string;
  start: { line: number };
  end: { line: number };
  extra: {
    message: string;
    severity: string;
    metadata?: {
      category?: string;
      cwe?: string[];
      owasp?: string[];
    };
  };
}

async function findSemgrep(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("which", ["semgrep"]);
    return stdout.trim();
  } catch {
    return null;
  }
}

const RELEVANT_CATEGORIES = new Set([
  "security",
  "correctness",
  "owasp",
]);

function isRelevant(m: SemgrepMatch): boolean {
  const sev = m.extra.severity?.toLowerCase();
  if (sev === "info") return false;

  const cat = m.extra.metadata?.category?.toLowerCase() || "";
  if (RELEVANT_CATEGORIES.has(cat)) return true;

  const id = m.check_id.toLowerCase();
  if (
    id.includes("injection") ||
    id.includes("xss") ||
    id.includes("auth") ||
    id.includes("validation") ||
    id.includes("webhook") ||
    id.includes("upload") ||
    id.includes("traversal") ||
    id.includes("ssrf") ||
    id.includes("csrf") ||
    id.includes("rce") ||
    id.includes("sql") ||
    id.includes("crypto") ||
    id.includes("secret") ||
    id.includes("hardcoded") ||
    id.includes("insecure")
  ) {
    return true;
  }

  if (sev === "error" || sev === "warning") return true;

  return false;
}

function mapSeverity(sev: string): "critical" | "medium" {
  return sev.toLowerCase() === "error" ? "critical" : "medium";
}

function formatSemgrepErrors(errors: SemgrepError[]): string {
  return errors
    .map((e) => e.long_msg || e.message || e.type || "unknown error")
    .filter(Boolean)
    .join("; ");
}

function parseSemgrepOutput(stdout: string): SemgrepResult {
  if (!stdout) return { results: [], errors: [] };
  return JSON.parse(stdout);
}

export async function scanSAST(
  repoPath: string,
  onProgress?: OnProgress
): Promise<{
  findings: Finding[];
  available: boolean;
  error?: string;
}> {
  let bin = await findSemgrep();
  if (!bin && onProgress) {
    bin = await autoInstallSemgrep(onProgress);
  }
  if (!bin) {
    return {
      findings: [],
      available: false,
      error:
        "semgrep not found — install it (pip install semgrep) to run SAST analysis",
    };
  }

  try {
    const { stdout } = await execFileAsync(
      bin,
      [
        "scan",
        "--config",
        "auto",
        "--json",
        "--quiet",
        "--timeout",
        "120",
        repoPath,
      ],
      { maxBuffer: 50 * 1024 * 1024, timeout: 300_000 }
    );

    const result = parseSemgrepOutput(stdout);

    if (result.errors?.length && (!result.results || result.results.length === 0)) {
      return {
        findings: [],
        available: true,
        error: `semgrep: ${formatSemgrepErrors(result.errors)}`,
      };
    }

    return { findings: resultsToFindings(result.results ?? [], repoPath), available: true };
  } catch (err: unknown) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };

    // semgrep may exit non-zero but still produce valid JSON with results and/or errors
    if (e.stdout) {
      try {
        const result = parseSemgrepOutput(e.stdout);

        if (result.results && result.results.length > 0) {
          return { findings: resultsToFindings(result.results, repoPath), available: true };
        }

        if (result.errors?.length) {
          return {
            findings: [],
            available: true,
            error: `semgrep: ${formatSemgrepErrors(result.errors)}`,
          };
        }
      } catch {
        /* JSON parse failed — fall through */
      }
    }

    const detail = e.stderr || e.message || String(err);
    return {
      findings: [],
      available: true,
      error: `semgrep error (exit ${e.code ?? "?"}): ${detail}`,
    };
  }
}

function normalizePath(filePath: string, repoPath: string): string {
  const prefix = repoPath.endsWith("/") ? repoPath : repoPath + "/";
  if (filePath.startsWith(prefix)) {
    return filePath.slice(prefix.length);
  }
  return filePath;
}

function resultsToFindings(results: SemgrepMatch[], repoPath: string): Finding[] {
  const seen = new Set<string>();
  const findings: Finding[] = [];

  const relevant = results.filter(isRelevant);

  for (const m of relevant) {
    const relPath = normalizePath(m.path, repoPath);
    const key = `${m.check_id}:${relPath}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const shortId = m.check_id.split(".").pop() || m.check_id;
    const message = m.extra.message || shortId;

    findings.push({
      id: 0,
      severity: mapSeverity(m.extra.severity),
      path: relPath,
      title: message.length > 120 ? message.slice(0, 117) + "…" : message,
      meta: `semgrep · ${shortId}`,
      source: "semgrep",
      trace: null,
      manual: null,
    });
  }

  return findings;
}
