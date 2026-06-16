import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "../types.js";
import { autoInstallGitleaks, type OnProgress } from "./installer.js";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

interface GitleaksMatch {
  Description: string;
  File: string;
  StartLine: number;
  Commit: string;
  Rule: string;
  Match?: string;
}

async function findGitleaks(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("which", ["gitleaks"]);
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function scanSecrets(
  repoPath: string,
  onProgress?: OnProgress
): Promise<{
  findings: Finding[];
  available: boolean;
  error?: string;
}> {
  let bin = await findGitleaks();
  if (!bin && onProgress) {
    bin = await autoInstallGitleaks(onProgress);
  }
  if (!bin) {
    return {
      findings: [],
      available: false,
      error:
        "gitleaks not found — install it (brew install gitleaks) to scan for secrets in git history",
    };
  }

  const isGitRepo = existsSync(join(repoPath, ".git"));
  if (!isGitRepo) {
    return {
      findings: [],
      available: true,
      error: "not a git repository — skipping git history secret scan",
    };
  }

  try {
    let stdout: string;
    const gitleaksArgs = ["detect", "--source", repoPath, "--report-format", "json", "--no-banner"];

    if (bin === "npx-gitleaks") {
      const result = await execAsync(
        `npx --yes @gitleaks/gitleaks ${gitleaksArgs.join(" ")}`,
        { maxBuffer: 50 * 1024 * 1024, timeout: 120_000 }
      );
      stdout = result.stdout;
    } else {
      const result = await execFileAsync(bin, gitleaksArgs, {
        maxBuffer: 50 * 1024 * 1024,
        timeout: 120_000,
      });
      stdout = result.stdout;
    }

    const matches: GitleaksMatch[] = JSON.parse(stdout || "[]");
    return { findings: matchesToFindings(matches), available: true };
  } catch (err: unknown) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    // gitleaks exits 1 when findings are present
    if (e.code === 1 && e.stdout) {
      try {
        const matches: GitleaksMatch[] = JSON.parse(e.stdout);
        return { findings: matchesToFindings(matches), available: true };
      } catch {
        /* fall through */
      }
    }
    // Exit code 0 means no findings
    if (e.code === 0) {
      return { findings: [], available: true };
    }
    return {
      findings: [],
      available: true,
      error: `gitleaks error: ${e.stderr || String(err)}`,
    };
  }
}

function matchesToFindings(matches: GitleaksMatch[]): Finding[] {
  const seen = new Set<string>();
  const findings: Finding[] = [];

  for (const m of matches) {
    const key = `${m.Rule}:${m.File}:${m.Commit}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const isServiceRole =
      m.Description?.toLowerCase().includes("service_role") ||
      m.Rule?.toLowerCase().includes("supabase") ||
      m.Match?.includes("service_role");

    const shortCommit = m.Commit?.slice(0, 7) || "unknown";

    findings.push({
      id: 0,
      severity: isServiceRole ? "critical" : "critical",
      path: `git history · commit ${shortCommit}`,
      title: `${m.Description || m.Rule} committed${m.File ? ` in ${m.File}` : ""} — still live in history`,
      meta: `gitleaks · ${isServiceRole ? "key bypasses RLS entirely · rotate immediately" : "rotate this credential immediately"}`,
      source: "gitleaks",
      trace: null,
      fix: null,
      manual:
        "Not a generation issue — a leaked credential. Rotate the key in the relevant service, then purge it from git history. No prompt rewrite applies.",
    });
  }

  return findings;
}
