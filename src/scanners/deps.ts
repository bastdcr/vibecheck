import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "../types.js";

const execFileAsync = promisify(execFile);

interface NpmAuditResult {
  vulnerabilities: Record<
    string,
    {
      name: string;
      severity: string;
      via: Array<string | { title?: string; url?: string; cwe?: string[] }>;
      effects: string[];
      fixAvailable: boolean | { name: string; version: string };
    }
  >;
  metadata?: {
    vulnerabilities: {
      critical: number;
      high: number;
      moderate: number;
      low: number;
    };
  };
}

export async function scanDeps(repoPath: string): Promise<{
  findings: Finding[];
  available: boolean;
  error?: string;
}> {
  const packageJson = join(repoPath, "package.json");
  if (!existsSync(packageJson)) {
    return {
      findings: [],
      available: false,
      error: "no package.json found — skipping dependency audit",
    };
  }

  try {
    const { stdout } = await execFileAsync(
      "npm",
      ["audit", "--json", "--omit=dev"],
      { cwd: repoPath, maxBuffer: 20 * 1024 * 1024, timeout: 60_000 }
    );

    return { findings: parseAudit(stdout), available: true };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    // npm audit exits non-zero when vulnerabilities are found
    if (e.stdout) {
      try {
        return { findings: parseAudit(e.stdout), available: true };
      } catch {
        /* fall through */
      }
    }
    return {
      findings: [],
      available: true,
      error: `npm audit error: ${e.stderr?.slice(0, 200) || String(err)}`,
    };
  }
}

function parseAudit(json: string): Finding[] {
  let result: NpmAuditResult;
  try {
    result = JSON.parse(json);
  } catch {
    return [];
  }

  if (!result.vulnerabilities) return [];

  const findings: Finding[] = [];
  for (const [, vuln] of Object.entries(result.vulnerabilities)) {
    const sev = vuln.severity?.toLowerCase();
    if (sev === "low" || sev === "info") continue;

    let title = `Known vulnerability in ${vuln.name}`;
    for (const v of vuln.via) {
      if (typeof v === "object" && v.title) {
        title = v.title;
        break;
      }
    }

    findings.push({
      id: 0,
      severity: sev === "critical" || sev === "high" ? "critical" : "medium",
      path: `package.json · ${vuln.name}`,
      title: title.length > 120 ? title.slice(0, 117) + "…" : title,
      meta: `npm audit · ${sev} severity${vuln.fixAvailable ? " · fix available" : ""}`,
      source: "deps",
      trace: null,
      manual:
        "Not a generation issue — a vulnerable dependency. Update or replace the package. No prompt rewrite applies.",
    });
  }

  return findings;
}
