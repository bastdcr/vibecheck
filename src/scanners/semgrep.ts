import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Finding } from "../types.js";
import { autoInstallSemgrep, type OnProgress } from "./installer.js";

const execFileAsync = promisify(execFile);

interface SemgrepResult {
  results: SemgrepMatch[];
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
        "--no-git-ignore",
        "--timeout",
        "60",
        repoPath,
      ],
      { maxBuffer: 50 * 1024 * 1024, timeout: 300_000 }
    );

    const result: SemgrepResult = JSON.parse(stdout || '{"results":[]}');
    return { findings: resultsToFindings(result.results), available: true };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    if (e.stdout) {
      try {
        const result: SemgrepResult = JSON.parse(e.stdout);
        return { findings: resultsToFindings(result.results), available: true };
      } catch {
        /* fall through */
      }
    }
    return {
      findings: [],
      available: true,
      error: `semgrep error: ${e.stderr?.slice(0, 200) || String(err)}`,
    };
  }
}

function resultsToFindings(results: SemgrepMatch[]): Finding[] {
  const seen = new Set<string>();
  const findings: Finding[] = [];

  const relevant = results.filter(isRelevant);

  for (const m of relevant) {
    const key = `${m.check_id}:${m.path}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const shortId = m.check_id.split(".").pop() || m.check_id;
    const message = m.extra.message || shortId;

    findings.push({
      id: 0,
      severity: mapSeverity(m.extra.severity),
      path: m.path,
      title: message.length > 120 ? message.slice(0, 117) + "…" : message,
      meta: `semgrep · ${shortId}`,
      source: "semgrep",
      trace: null,
      fix: null,
      manual: null,
    });
  }

  return findings;
}
