import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Finding, FindingStatus } from "../types.js";

const STATE_FILE = ".vibecheck";

export function generateKey(finding: Finding): string {
  const slug = (finding.meta || finding.title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${finding.source}:${finding.path}:${slug}`;
}

export async function loadState(
  repoPath: string
): Promise<Record<string, FindingStatus>> {
  const filePath = join(repoPath, STATE_FILE);
  if (!existsSync(filePath)) return {};

  try {
    const raw = JSON.parse(await readFile(filePath, "utf-8"));
    return raw.findings || {};
  } catch {
    return {};
  }
}

export async function saveState(
  repoPath: string,
  findings: Finding[],
  statuses: FindingStatus[]
): Promise<void> {
  const state: Record<string, FindingStatus> = {};

  for (let i = 0; i < findings.length; i++) {
    const key = generateKey(findings[i]);
    if (statuses[i] !== "open") {
      state[key] = statuses[i];
    }
  }

  const filePath = join(repoPath, STATE_FILE);
  await writeFile(
    filePath,
    JSON.stringify({ findings: state }, null, 2) + "\n",
    "utf-8"
  );
}

export function applyState(
  findings: Finding[],
  saved: Record<string, FindingStatus>
): FindingStatus[] {
  return findings.map((f) => {
    const key = generateKey(f);
    const status = saved[key];
    if (status === "ignored") return "ignored";
    // solved findings that still appear in the scan are re-opened
    if (status === "solved") return "open";
    return "open";
  });
}
