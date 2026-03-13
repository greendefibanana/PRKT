import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { spawnSync } from "child_process";

import {
  assertMintMatchesRpcCluster,
  detectClusterFromRpcUrl,
  getOptionalSecretKey,
  getOptionalDevnetTreasurySecretKey,
  getRemoteSignerConfig,
  getRpcUrl,
  getUsdcMintAddress
} from "../config/env";

type RehearsalCheck = {
  detail: string;
  ok: boolean;
  title: string;
};

function runCommand(command: string, args: string[]): RehearsalCheck {
  const result = spawnSync([command, ...args].join(" "), {
    shell: true,
    stdio: "inherit"
  });

  return {
    detail: `${command} ${args.join(" ")}`,
    ok: result.status === 0,
    title: `Command ${command}`
  };
}

function runPreflightChecks(): RehearsalCheck[] {
  const checks: RehearsalCheck[] = [];
  const rpcUrl = getRpcUrl();
  const cluster = detectClusterFromRpcUrl(rpcUrl);
  const usdcMint = getUsdcMintAddress();
  const signerCheck = resolveSignerCheck();

  checks.push({
    detail: rpcUrl,
    ok: cluster === "devnet",
    title: "RPC cluster is devnet"
  });

  try {
    assertMintMatchesRpcCluster({
      mintAddress: usdcMint,
      mintName: "USDC_MINT",
      rpcUrl
    });
    checks.push({
      detail: usdcMint,
      ok: true,
      title: "USDC mint matches RPC cluster"
    });
  } catch (error: unknown) {
    checks.push({
      detail: error instanceof Error ? error.message : "mint and cluster mismatch",
      ok: false,
      title: "USDC mint matches RPC cluster"
    });
  }

  checks.push({
    detail: signerCheck.detail,
    ok: signerCheck.ok,
    title: "signer configuration is present"
  });

  checks.push({
    detail: "raydium_lp.devnet.json",
    ok: existsSync("raydium_lp.devnet.json"),
    title: "Raydium devnet LP config exists"
  });

  checks.push(runCommand("npm", ["run", "release:check"]));

  return checks;
}

function resolveSignerCheck(): { detail: string; ok: boolean } {
  try {
    const remoteSigner = getRemoteSignerConfig();
    if (remoteSigner) {
      return {
        detail: `remote signer ${remoteSigner.publicKey.toBase58()}`,
        ok: true
      };
    }

    if (getOptionalDevnetTreasurySecretKey()) {
      return {
        detail: "devnet treasury key present",
        ok: true
      };
    }

    if (getOptionalSecretKey()) {
      return {
        detail: "local demo key present",
        ok: true
      };
    }

    return {
      detail: "missing signer config",
      ok: false
    };
  } catch (error: unknown) {
    return {
      detail: error instanceof Error ? error.message : "invalid signer config",
      ok: false
    };
  }
}

function writeSessionArtifact(checks: RehearsalCheck[]): string {
  const artifactDir = path.join(process.cwd(), "artifacts");
  if (!existsSync(artifactDir)) {
    mkdirSync(artifactDir, { recursive: true });
  }

  const artifactPath = path.join(artifactDir, "demo-session.json");
  const payload = {
    cluster: detectClusterFromRpcUrl(getRpcUrl()),
    generatedAtIso8601: new Date().toISOString(),
    recommendedLiveRunOrder: [
      "npm run demo:feature-matrix:devnet",
      "npm run wallet:devnet",
      "npm run defi:lp:devnet",
      "npm run simulate-attack",
      "npm run stress:agents"
    ],
    checks
  };

  writeFileSync(artifactPath, JSON.stringify(payload, null, 2), "utf8");
  return artifactPath;
}

function main(): void {
  console.log("PRKT demo rehearsal");
  const checks = runPreflightChecks();

  let failures = 0;
  for (const check of checks) {
    const marker = check.ok ? "PASS" : "FAIL";
    console.log(`[${marker}] ${check.title} -> ${check.detail}`);
    if (!check.ok) {
      failures += 1;
    }
  }

  const artifactPath = writeSessionArtifact(checks);
  console.log(`Session artifact: ${artifactPath}`);

  if (failures > 0) {
    console.error(`Demo rehearsal preflight failed with ${failures} failing check(s).`);
    process.exitCode = 1;
    return;
  }

  console.log("Demo rehearsal preflight passed.");
  console.log("Next: run the recommended live order, starting with the devnet feature matrix.");
  console.log("Record resulting signatures and artifact paths in artifacts/bounty-evidence.md.");
}

main();
