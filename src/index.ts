#!/usr/bin/env node

import { resolve } from "node:path";
import pc from "picocolors";
import { runAllScanners } from "./scanners/aggregator.js";
import { readClaudeHistory } from "./claude/reader.js";
import { correlateFindings } from "./claude/correlator.js";
import { printBoot, printNoFindings } from "./repl/display.js";
import { startRepl } from "./repl/repl.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const withClaudeHistory = args.includes("--with-claude-history");
  const dbUrlIdx = args.indexOf("--db-url");
  const dbUrl = dbUrlIdx !== -1 ? args[dbUrlIdx + 1] : undefined;
  const helpFlag = args.includes("--help") || args.includes("-h");

  if (helpFlag) {
    printUsage();
    process.exit(0);
  }

  // Determine repo path: first non-flag arg, or cwd
  let repoPath = process.cwd();
  for (const arg of args) {
    if (!arg.startsWith("-") && arg !== dbUrl) {
      repoPath = resolve(arg);
      break;
    }
  }

  // Banner
  console.log(
    `$ npx vibecheck ${withClaudeHistory ? pc.magenta("--with-claude-history") : ""}`
  );
  console.log();

  // Run scanners
  const result = await runAllScanners(
    { repoPath, dbUrl, withClaudeHistory },
    (msg) => console.log(pc.dim(msg))
  );

  // Read Claude history if requested
  if (withClaudeHistory) {
    try {
      const { sessions, sessionCount } =
        await readClaudeHistory(repoPath);
      result.stats.claudeSessions = sessionCount;

      if (sessions.length > 0 && result.findings.length > 0) {
        correlateFindings(result.findings, sessions, repoPath);
      }
    } catch (err) {
      console.log(
        pc.dim(
          pc.yellow(
            `  ⚠ could not read claude history: ${String(err)}`
          )
        )
      );
    }
  }

  // Fill in manual notes for findings that weren't correlated
  for (const f of result.findings) {
    if (!f.trace && !f.manual) {
      if (f.source === "rls") {
        f.manual =
          "Enable row level security on this table and add appropriate policies. Without RLS, any client with the anon key can read and write all rows.";
      } else if (f.source === "semgrep") {
        f.manual =
          "This is a code-level issue found by static analysis. Review the flagged code and apply the recommended fix.";
      }
    }
  }

  // Boot line
  printBoot(result.stats, withClaudeHistory);

  if (result.findings.length === 0) {
    printNoFindings();
    return;
  }

  // Start interactive REPL
  await startRepl(result.findings, result.stats, repoPath);
}

function printUsage(): void {
  console.log(`
${pc.bold("vibecheck")} — audit AI-generated codebases

${pc.dim("USAGE")}
  npx vibecheck [options] [path]

${pc.dim("OPTIONS")}
  --with-claude-history   Read Claude Code session history and correlate
                          findings to the prompts that generated them
  --db-url <url>          Live Supabase RLS check via a postgres connection
  -h, --help              Show this help

${pc.dim("EXAMPLES")}
  npx vibecheck                             scan current directory
  npx vibecheck --with-claude-history       scan + trace prompt origins
  npx vibecheck --db-url postgres://...     include live RLS check
  npx vibecheck ~/projects/my-app           scan a specific directory

${pc.dim("COMMANDS (interactive)")}
  1-N        inspect a finding
  fix / f    show the secure prompt rewrite
  ignore / i dismiss the current finding
  next / n   jump to the next open finding
  list / l   reprint findings
  help / ?   show commands
  q          finish and write report

${pc.dim(pc.gray("local only — no code, prompts, or secrets leave this machine."))}
`);
}

main().catch((err) => {
  console.error(pc.red(`fatal: ${err.message || err}`));
  process.exit(1);
});
