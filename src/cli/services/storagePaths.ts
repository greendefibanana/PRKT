import { mkdirSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

const CLI_HOME_ENV = "PRKT_CLI_HOME";

function resolveBaseDir(): string {
  const override = process.env[CLI_HOME_ENV]?.trim();
  if (override) {
    return path.resolve(override);
  }

  if (process.platform === "win32") {
    const windowsBase = process.env.APPDATA || process.env.LOCALAPPDATA;
    if (windowsBase) {
      return path.join(windowsBase, "PRKT");
    }
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "PRKT");
  }

  const xdgBase = process.env.XDG_DATA_HOME?.trim();
  if (xdgBase) {
    return path.join(xdgBase, "prkt");
  }

  return path.join(os.homedir(), ".local", "share", "prkt");
}

export function getCliDataDir(): string {
  const baseDir = resolveBaseDir();
  mkdirSync(baseDir, { recursive: true, mode: 0o700 });
  return baseDir;
}

export function resolveCliDataPath(fileName: string): string {
  return path.join(getCliDataDir(), fileName);
}

export function getCliHomeEnvName(): string {
  return CLI_HOME_ENV;
}

export function probeCliDataDir(): {
  details: string;
  path: string;
  writable: boolean;
} {
  const dataDir = getCliDataDir();
  const probePath = path.join(dataDir, ".prkt-write-test");

  try {
    writeFileSync(probePath, "ok", { mode: 0o600 });
    rmSync(probePath, { force: true });
    return {
      details: "ok",
      path: dataDir,
      writable: true
    };
  } catch (error: unknown) {
    return {
      details: error instanceof Error ? error.message : "unknown write error",
      path: dataDir,
      writable: false
    };
  }
}
