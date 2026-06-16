import { writeFile, unlink, readFile, chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import pc from "picocolors";

const MARKER = "# vibecheck hook";

const PRE_PUSH_SCRIPT = `#!/bin/sh
${MARKER}
npx vibe-checking --with-cursor-history --with-claude-history
`;

function hookPath(repoPath: string): string {
  return join(repoPath, ".git", "hooks", "pre-push");
}

export function isHookInstalled(repoPath: string): boolean {
  const path = hookPath(repoPath);
  if (!existsSync(path)) return false;
  try {
    const content = readFileSync(path, "utf-8");
    return content.includes(MARKER);
  } catch {
    return false;
  }
}

export async function installHook(repoPath: string): Promise<void> {
  const hooksDir = join(repoPath, ".git", "hooks");
  if (!existsSync(join(repoPath, ".git"))) {
    console.log(pc.red("not a git repository — cannot install hook."));
    return;
  }

  const path = hookPath(repoPath);

  if (existsSync(path)) {
    const existing = await readFile(path, "utf-8");
    if (existing.includes(MARKER)) {
      console.log(pc.dim("vibecheck hook is already installed."));
      return;
    }
    // Append to existing hook
    await writeFile(path, existing.trimEnd() + "\n\n" + PRE_PUSH_SCRIPT, "utf-8");
    console.log(pc.green("✓ vibecheck added to existing pre-push hook."));
  } else {
    if (!existsSync(hooksDir)) {
      await mkdir(hooksDir, { recursive: true });
    }
    await writeFile(path, PRE_PUSH_SCRIPT, "utf-8");
    await chmod(path, 0o755);
    console.log(pc.green("✓ pre-push hook installed."));
  }

  console.log(pc.dim("vibecheck will run automatically on every git push."));
}

export async function removeHook(repoPath: string): Promise<void> {
  const path = hookPath(repoPath);

  if (!existsSync(path)) {
    console.log(pc.dim("no pre-push hook found."));
    return;
  }

  const content = await readFile(path, "utf-8");
  if (!content.includes(MARKER)) {
    console.log(pc.dim("pre-push hook exists but was not installed by vibecheck."));
    return;
  }

  // If the hook only contains our script, remove the file
  const lines = content.split("\n");
  const otherLines = lines.filter(
    (l) => !l.includes(MARKER) && !l.includes("vibe-checking") && l.trim() !== "#!/bin/sh" && l.trim() !== ""
  );

  if (otherLines.length === 0) {
    await unlink(path);
    console.log(pc.green("✓ pre-push hook removed."));
  } else {
    // Remove just our section
    const cleaned = content
      .replace(/\n*# vibecheck hook\nnpx vibe-checking[^\n]*/g, "")
      .trimEnd() + "\n";
    await writeFile(path, cleaned, "utf-8");
    console.log(pc.green("✓ vibecheck removed from pre-push hook."));
  }
}
