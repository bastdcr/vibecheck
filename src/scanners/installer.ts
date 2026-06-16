import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export type OnProgress = (msg: string) => void;

async function hasBrew(): Promise<boolean> {
  try {
    await execFileAsync("which", ["brew"]);
    return true;
  } catch {
    return false;
  }
}

async function hasPip(): Promise<string | null> {
  for (const bin of ["pip3", "pip", "python3 -m pip", "python -m pip"]) {
    try {
      if (bin.includes(" ")) {
        await execAsync(`${bin} --version`);
      } else {
        await execFileAsync("which", [bin]);
      }
      return bin;
    } catch {
      continue;
    }
  }
  return null;
}

async function hasNpx(): Promise<boolean> {
  try {
    await execFileAsync("which", ["npx"]);
    return true;
  } catch {
    return false;
  }
}

export async function autoInstallGitleaks(
  onProgress: OnProgress
): Promise<string | null> {
  onProgress("gitleaks not found — attempting auto-install…");

  // macOS: try brew
  if (platform() === "darwin" && (await hasBrew())) {
    try {
      onProgress("  → brew install gitleaks");
      await execAsync("brew install gitleaks", { timeout: 120_000 });
      const { stdout } = await execFileAsync("which", ["gitleaks"]);
      onProgress("  ✓ gitleaks installed");
      return stdout.trim();
    } catch (err) {
      onProgress(
        `  ✗ brew install failed: ${(err as Error).message?.slice(0, 100)}`
      );
    }
  }

  // Linux: try brew if available, otherwise try downloading the binary
  if (platform() === "linux" && (await hasBrew())) {
    try {
      onProgress("  → brew install gitleaks");
      await execAsync("brew install gitleaks", { timeout: 120_000 });
      const { stdout } = await execFileAsync("which", ["gitleaks"]);
      onProgress("  ✓ gitleaks installed");
      return stdout.trim();
    } catch {
      /* fall through */
    }
  }

  // Try npx as a last resort (gitleaks has an npm wrapper)
  if (await hasNpx()) {
    try {
      onProgress("  → checking npx @gitleaks/gitleaks");
      await execAsync("npx --yes @gitleaks/gitleaks version", {
        timeout: 60_000,
      });
      onProgress("  ✓ gitleaks available via npx");
      return "npx-gitleaks";
    } catch {
      /* fall through */
    }
  }

  onProgress(
    "  ✗ could not auto-install gitleaks — install manually: brew install gitleaks"
  );
  return null;
}

export async function autoInstallSemgrep(
  onProgress: OnProgress
): Promise<string | null> {
  onProgress("semgrep not found — attempting auto-install…");

  // Try pip/pip3
  const pip = await hasPip();
  if (pip) {
    try {
      const cmd = pip.includes(" ")
        ? `${pip} install semgrep`
        : `${pip} install semgrep`;
      onProgress(`  → ${cmd}`);
      await execAsync(cmd, { timeout: 180_000 });
      const { stdout } = await execFileAsync("which", ["semgrep"]);
      onProgress("  ✓ semgrep installed");
      return stdout.trim();
    } catch (err) {
      onProgress(
        `  ✗ pip install failed: ${(err as Error).message?.slice(0, 100)}`
      );
    }
  }

  // macOS: try brew
  if (platform() === "darwin" && (await hasBrew())) {
    try {
      onProgress("  → brew install semgrep");
      await execAsync("brew install semgrep", { timeout: 180_000 });
      const { stdout } = await execFileAsync("which", ["semgrep"]);
      onProgress("  ✓ semgrep installed");
      return stdout.trim();
    } catch (err) {
      onProgress(
        `  ✗ brew install failed: ${(err as Error).message?.slice(0, 100)}`
      );
    }
  }

  onProgress(
    "  ✗ could not auto-install semgrep — install manually: pip install semgrep"
  );
  return null;
}
