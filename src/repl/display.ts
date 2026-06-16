import pc from "picocolors";
import type { Finding, FindingStatus } from "../types.js";
import { computeScore } from "../scanners/aggregator.js";

const RULE_LINE =
  "─────────────────────────────────────────────────────────────";

function sevTag(sev: "critical" | "medium"): string {
  return sev === "critical"
    ? pc.bold(pc.red("CRITICAL"))
    : pc.bold(pc.yellow("MEDIUM  "));
}

function colorByCol(text: string, col: string): string {
  switch (col) {
    case "rust":
      return pc.red(text);
    case "amber":
      return pc.yellow(text);
    case "green":
      return pc.green(text);
    default:
      return text;
  }
}

export function printBoot(
  stats: {
    gitHistory: boolean;
    sourceScanned: boolean;
    supabaseMigrations: boolean;
    claudeSessions: number;
    cursorSessions: number;
    stack: string[];
    contributors: number;
  },
  withClaude: boolean,
  withCursor: boolean = false
): void {
  const parts: string[] = [];
  if (stats.gitHistory) parts.push("git history");
  if (stats.sourceScanned) parts.push("source");
  if (stats.supabaseMigrations) parts.push("supabase migrations");
  if (withClaude && stats.claudeSessions > 0) {
    parts.push(pc.green(`${stats.claudeSessions} claude code sessions`));
  }
  if (withCursor && stats.cursorSessions > 0) {
    parts.push(pc.green(`${stats.cursorSessions} cursor sessions`));
  }

  console.log(
    pc.dim(`scanned ${parts.join(" · ")}`)
  );

  const stackParts: string[] = [];
  if (stats.stack.length > 0) stackParts.push(stats.stack.join(" · "));
  if (stats.contributors > 0)
    stackParts.push(`${stats.contributors} contributor${stats.contributors !== 1 ? "s" : ""}`);

  if (stackParts.length > 0) {
    console.log(pc.dim(pc.gray(`stack: ${stackParts.join(" · ")}`)));
  }
}

export function printList(
  findings: Finding[],
  statuses: FindingStatus[]
): void {
  const { score, verdict, col } = computeScore(findings, statuses);
  const open = statuses.filter((s) => s === "open").length;
  const cleared = findings.length - open;
  const traced = findings.filter((f) => f.trace !== null).length;

  console.log();
  let summaryLine = `${colorByCol(pc.bold(verdict), col)}  score ${colorByCol(pc.bold(String(score)), col)}${pc.dim(pc.gray("/10"))}  ·  ${pc.dim(`${open} open · ${cleared} cleared`)}`;
  if (traced > 0) {
    summaryLine += `  ·  ${pc.magenta(`${traced} traced to prompts`)}`;
  }
  console.log(summaryLine);
  console.log(pc.dim(pc.gray(RULE_LINE)));

  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    const n = String(i + 1).padStart(2, "0");
    const status = statuses[i];

    let tag = "";
    if (status === "fixed") tag = " " + pc.green("✓ fix shown");
    if (status === "ignored") tag = " " + pc.dim("⊘ ignored");

    const line = `  ${pc.dim(n)}  ${sevTag(f.severity)}  ${pc.dim(f.path)}${tag}`;
    const titleText =
      status === "open" ? f.title : pc.dim(pc.strikethrough(f.title));
    const title = `      ${titleText}`;

    console.log(line);
    console.log(title);
  }

  console.log(pc.dim(pc.gray(RULE_LINE)));
  console.log(
    pc.dim(
      pc.gray(
        `type a ${pc.magenta("number")} to inspect · ${pc.magenta("list")} · ${pc.magenta("help")} · ${pc.magenta("q")} to finish`
      )
    )
  );
  console.log();
}

export function printInspect(
  finding: Finding,
  index: number
): void {
  const n = String(index + 1).padStart(2, "0");

  console.log();
  console.log(
    pc.dim(`finding ${n} ──────────────────────────────────────────────────`)
  );
  console.log(`${sevTag(finding.severity)}  ${pc.bold(finding.title)}`);
  console.log(pc.dim(pc.gray(finding.path)));
  console.log(pc.dim(finding.meta));
  console.log();

  if (finding.trace) {
    console.log(pc.bold(pc.magenta("PROMPT TRACE")));
    console.log(
      `  ${pc.dim(pc.gray("prompt  "))} ${pc.white(finding.trace.prompt)}`
    );
    console.log(
      `  ${pc.magenta("↓")} ${pc.dim(pc.gray(finding.trace.session))}`
    );
    console.log(
      `  ${pc.dim(pc.gray("generated"))} ${pc.dim(finding.trace.file)}`
    );
    console.log(`  ${pc.magenta("↓")}`);
    console.log(
      `  ${pc.dim(pc.gray("result  "))} ${finding.trace.result}`
    );
    console.log();
    console.log(
      pc.dim(
        pc.gray(
          `commands: ${pc.magenta("fix")} show secure prompt · ${pc.magenta("ignore")} · ${pc.magenta("next")} · ${pc.magenta("list")}`
        )
      )
    );
  } else {
    console.log(pc.dim(finding.manual || "No additional details."));
    console.log();
    console.log(
      pc.dim(
        pc.gray(
          `commands: ${pc.magenta("ignore")} · ${pc.magenta("next")} · ${pc.magenta("list")}  ${pc.dim(pc.gray("(no prompt rewrite for this one)"))}`
        )
      )
    );
  }

  console.log();
}

export function printFix(finding: Finding): void {
  if (!finding.fix) {
    console.log(
      pc.dim(
        pc.gray(
          "this finding has no prompt rewrite — it isn't a generation issue."
        )
      )
    );
    console.log();
    return;
  }

  console.log(
    `${pc.bold(pc.green("REWRITTEN PROMPT"))} ${pc.dim(pc.gray("— same task, generated securely the first time"))}`
  );

  for (let i = 0; i < finding.fix.length; i++) {
    if (i === 0) {
      console.log(`  ${finding.fix[i]}`);
    } else {
      console.log(`  ${pc.green(finding.fix[i])}`);
    }
  }

  console.log();
  console.log(
    pc.dim(
      pc.gray(
        `→ regenerated against this prompt: ${pc.green("0 findings")}. vibecheck shows the fix — it never edits your code.`
      )
    )
  );
  console.log();
}

export function printIgnore(index: number, ignored: boolean): void {
  const n = String(index + 1).padStart(2, "0");
  console.log(
    pc.dim(`finding ${n} ${ignored ? "ignored" : "restored"}.`)
  );
  console.log();
}

export function printHelp(findingCount: number): void {
  console.log();
  console.log(pc.dim("commands"));
  console.log(
    `  ${pc.magenta(`1-${findingCount}`)}      inspect a finding (shows summary + prompt trace)`
  );
  console.log(
    `  ${pc.magenta("fix")}      show the secure prompt for the current finding`
  );
  console.log(
    `  ${pc.magenta("ignore")}   dismiss the current finding`
  );
  console.log(
    `  ${pc.magenta("next")}     jump to the next open finding`
  );
  console.log(
    `  ${pc.magenta("list")}     show all findings again`
  );
  console.log(
    `  ${pc.magenta("q")}        finish and write the report`
  );
  console.log();
}

export function printFinish(
  findings: Finding[],
  statuses: FindingStatus[],
  reportPath: string
): void {
  const generationCaused = findings.filter((f) => f.trace !== null).length;

  console.log();
  console.log(pc.dim("writing report…"));
  console.log(pc.green(`✓ ${reportPath} saved`));
  console.log();

  if (generationCaused > 0) {
    console.log(
      pc.bold(
        pc.red(
          `${generationCaused} of these findings would never have been generated.`
        )
      )
    );
  }
  console.log(
    pc.dim(
      "vibecheck looked back at what happened. It can't stop the next insecure"
    )
  );
  console.log(
    pc.dim(
      "prompt — Symbiotic does that at generation time, continuously."
    )
  );
  console.log(pc.dim(pc.gray("→ https://www.symbioticsec.ai")));
  console.log();
  console.log(
    pc.dim(pc.gray("no code, prompts, or secrets left this machine."))
  );
  console.log();
}

export function printNoFindings(): void {
  console.log();
  console.log(pc.bold(pc.green("HARDENED")) + "  score " + pc.bold(pc.green("10.0")) + pc.dim(pc.gray("/10")));
  console.log();
  console.log(pc.green("no security findings detected — looking good."));
  console.log();
  console.log(
    pc.dim(pc.gray("no code, prompts, or secrets left this machine."))
  );
  console.log();
}
