import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Finding } from "../types.js";

const execFileAsync = promisify(execFile);

interface TableInfo {
  name: string;
  file: string;
  hasRLS: boolean;
  policies: string[];
  isPermissive: boolean;
  lineCount: number;
}

export async function scanRLS(
  repoPath: string,
  dbUrl?: string
): Promise<{
  findings: Finding[];
  available: boolean;
  error?: string;
}> {
  if (dbUrl) {
    return scanRLSLive(dbUrl);
  }
  return scanRLSStatic(repoPath);
}

async function scanRLSStatic(repoPath: string): Promise<{
  findings: Finding[];
  available: boolean;
  error?: string;
}> {
  const migrationsDir = join(repoPath, "supabase", "migrations");
  if (!existsSync(migrationsDir)) {
    return {
      findings: [],
      available: false,
      error: "no supabase/migrations directory found — skipping RLS scan",
    };
  }

  let files: string[];
  try {
    files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql"));
  } catch {
    return {
      findings: [],
      available: false,
      error: "could not read supabase/migrations — skipping RLS scan",
    };
  }

  if (files.length === 0) {
    return {
      findings: [],
      available: true,
      error: "no .sql files in supabase/migrations",
    };
  }

  const tables = new Map<string, TableInfo>();

  for (const file of files) {
    const filePath = join(migrationsDir, file);
    const sql = await readFile(filePath, "utf-8");
    const relPath = `supabase/migrations/${file}`;
    parseMigration(sql, relPath, tables);
  }

  const findings: Finding[] = [];
  for (const [, table] of tables) {
    if (!table.hasRLS) {
      findings.push({
        id: 0,
        severity: "critical",
        path: table.file,
        title: `Table ${table.name} has no RLS policy`,
        meta: `anon key can read/write this table via the public API`,
        source: "rls",
        trace: null,
        manual: null,
      });
    } else if (table.isPermissive) {
      findings.push({
        id: 0,
        severity: "medium",
        path: table.file,
        title: `Table ${table.name} has an overly permissive RLS policy`,
        meta: `policy uses USING (true) or allows anon full access`,
        source: "rls",
        trace: null,
        manual: null,
      });
    }
  }

  return { findings, available: true };
}

function parseMigration(
  sql: string,
  file: string,
  tables: Map<string, TableInfo>
): void {
  const lines = sql.split("\n");
  const lineCount = lines.length;

  // Match CREATE TABLE statements
  const createTableRe =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["']?(\w+)["']?/gi;
  let match: RegExpExecArray | null;
  while ((match = createTableRe.exec(sql)) !== null) {
    const name = match[1].toLowerCase();
    if (
      name.startsWith("_") ||
      name === "schema_migrations" ||
      name === "extensions"
    ) {
      continue;
    }
    if (!tables.has(name)) {
      tables.set(name, {
        name,
        file,
        hasRLS: false,
        policies: [],
        isPermissive: false,
        lineCount,
      });
    }
  }

  // Match ALTER TABLE ... ENABLE ROW LEVEL SECURITY
  const enableRLSRe =
    /ALTER\s+TABLE\s+(?:public\.)?["']?(\w+)["']?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
  while ((match = enableRLSRe.exec(sql)) !== null) {
    const name = match[1].toLowerCase();
    const info = tables.get(name);
    if (info) info.hasRLS = true;
  }

  // Match CREATE POLICY
  const policyRe =
    /CREATE\s+POLICY\s+["']?(\w+)["']?\s+ON\s+(?:public\.)?["']?(\w+)["']?/gi;
  while ((match = policyRe.exec(sql)) !== null) {
    const tableName = match[2].toLowerCase();
    const info = tables.get(tableName);
    if (info) info.policies.push(match[1]);
  }

  // Check for overly permissive policies: USING (true) on tables with RLS
  const permissiveRe =
    /CREATE\s+POLICY\s+\S+\s+ON\s+(?:public\.)?["']?(\w+)["']?[\s\S]*?USING\s*\(\s*true\s*\)/gi;
  while ((match = permissiveRe.exec(sql)) !== null) {
    const name = match[1].toLowerCase();
    const info = tables.get(name);
    if (info) info.isPermissive = true;
  }
}

async function scanRLSLive(dbUrl: string): Promise<{
  findings: Finding[];
  available: boolean;
  error?: string;
}> {
  let psqlBin: string;
  try {
    const { stdout } = await execFileAsync("which", ["psql"]);
    psqlBin = stdout.trim();
  } catch {
    return {
      findings: [],
      available: false,
      error: "psql not found — cannot run live RLS check",
    };
  }

  try {
    const { stdout } = await execFileAsync(
      psqlBin,
      [
        dbUrl,
        "-t",
        "-A",
        "-c",
        `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';`,
      ],
      { timeout: 15_000 }
    );

    const findings: Finding[] = [];
    for (const line of stdout.trim().split("\n")) {
      if (!line) continue;
      const [table, rls] = line.split("|");
      if (rls === "f" || rls === "false") {
        findings.push({
          id: 0,
          severity: "critical",
          path: `database · public.${table}`,
          title: `Table ${table} has no RLS policy (live check)`,
          meta: `pg_tables rowsecurity=false · anon key can access this table`,
          source: "rls",
          trace: null,
          manual: null,
        });
      }
    }

    return { findings, available: true };
  } catch (err) {
    return {
      findings: [],
      available: true,
      error: `psql error: ${String(err)}`,
    };
  }
}
