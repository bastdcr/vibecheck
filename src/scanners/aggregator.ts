import { scanSecrets } from "./gitleaks.js";
import { scanSAST } from "./semgrep.js";
import { scanRLS } from "./rls.js";
import { scanDeps } from "./deps.js";
import type { Finding, ScanResult } from "../types.js";

export interface ScanOptions {
  repoPath: string;
  dbUrl?: string;
  withClaudeHistory: boolean;
}

export async function runAllScanners(
  options: ScanOptions,
  onProgress: (msg: string) => void
): Promise<ScanResult> {
  const { repoPath, dbUrl } = options;
  const allFindings: Finding[] = [];
  const errors: string[] = [];

  const stack = await detectStack(repoPath);

  // Run all scanners concurrently (pass onProgress for auto-install)
  onProgress("scanning…");
  const [secrets, sast, rls, deps] = await Promise.all([
    scanSecrets(repoPath, onProgress),
    scanSAST(repoPath, onProgress),
    scanRLS(repoPath, dbUrl),
    scanDeps(repoPath),
  ]);

  if (secrets.error) errors.push(secrets.error);
  if (sast.error) errors.push(sast.error);
  if (rls.error) errors.push(rls.error);
  if (deps.error) errors.push(deps.error);

  allFindings.push(...secrets.findings);
  allFindings.push(...sast.findings);
  allFindings.push(...rls.findings);
  allFindings.push(...deps.findings);

  for (const e of errors) {
    onProgress(`  ⚠ ${e}`);
  }

  // Assign sequential IDs
  allFindings.forEach((f, i) => {
    f.id = i + 1;
  });

  // Sort: critical first, then medium
  allFindings.sort((a, b) => {
    if (a.severity === "critical" && b.severity !== "critical") return -1;
    if (a.severity !== "critical" && b.severity === "critical") return 1;
    return 0;
  });

  // Re-assign IDs after sort
  allFindings.forEach((f, i) => {
    f.id = i + 1;
  });

  let contributors = 0;
  try {
    const { execFile: ef } = await import("node:child_process");
    const { promisify: p } = await import("node:util");
    const exec = p(ef);
    const { stdout } = await exec("git", ["shortlog", "-sn", "--all"], {
      cwd: repoPath,
      timeout: 10_000,
    });
    contributors = stdout.trim().split("\n").filter(Boolean).length;
  } catch {
    contributors = 1;
  }

  return {
    findings: allFindings,
    stats: {
      gitHistory: secrets.available,
      sourceScanned: sast.available,
      supabaseMigrations: rls.available,
      claudeSessions: 0,
      cursorSessions: 0,
      stack,
      contributors,
    },
  };
}

async function detectStack(repoPath: string): Promise<string[]> {
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { readFile } = await import("node:fs/promises");

  const stack: string[] = [];

  const pkgPath = join(repoPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      if (allDeps["next"]) stack.push("next.js");
      if (allDeps["react"]) stack.push("react");
      if (allDeps["@supabase/supabase-js"] || allDeps["supabase"])
        stack.push("supabase");
      if (allDeps["stripe"] || allDeps["@stripe/stripe-js"])
        stack.push("stripe");
    } catch {
      /* ignore */
    }
  }

  if (existsSync(join(repoPath, "vercel.json")) || existsSync(join(repoPath, ".vercel"))) {
    stack.push("vercel");
  }
  if (existsSync(join(repoPath, "supabase"))) {
    if (!stack.includes("supabase")) stack.push("supabase");
  }

  return stack;
}

export function computeScore(
  findings: Finding[],
  statuses: Array<"open" | "ignored" | "solved">
): { score: number; verdict: string; col: string } {
  const open = statuses.filter((s) => s === "open").length;
  const cleared = findings.length - open;
  const score = Math.min(10, 2.4 + cleared * 1.2);
  let verdict = "EXPOSED";
  let col = "rust";
  if (score >= 7) {
    verdict = "HARDENED";
    col = "green";
  } else if (score >= 4.5) {
    verdict = "AT RISK";
    col = "amber";
  }
  return { score: parseFloat(score.toFixed(1)), verdict, col };
}
