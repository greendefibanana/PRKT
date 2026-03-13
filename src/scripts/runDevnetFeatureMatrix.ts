import { mkdirSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

import { BN } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";

import { SessionAnchor } from "../anchoring/SessionAnchor";
import { AuditLogManager } from "../compression/AuditLogManager";
import { PolicyAccountManager } from "../compression/PolicyAccountManager";
import { defaultPRKTConfig } from "../config/PRKTConfig";
import { detectClusterFromRpcUrl, getRpcUrl } from "../config/env";
import { BalanceService } from "../core/balances/BalanceService";
import { DevnetFundingService } from "../core/funding/DevnetFundingService";
import { RpcClient } from "../core/rpc/RpcClient";
import { TokenService } from "../core/tokens/TokenService";
import { TransactionService } from "../core/transactions/TransactionService";
import { WalletManager } from "../core/wallet/WalletManager";
import { PolicyEngine } from "../policy";
import { SandboxExecutor } from "../policy/sandbox/SandboxExecutor";
import { MEMO_PROGRAM_ID } from "../solana/programs";
import { ProofAnchor } from "../zk/ProofAnchor";

type MatrixStep = {
  category: string;
  detail: string;
  name: string;
  status: "ok" | "warn" | "fail" | "skip";
};

type MatrixSummary = {
  advanced?: {
    agentId: string;
    commitment: string;
    policyAccountSignature: string;
    proofSignature: string;
    sessionId: string;
    sessionSignature: string;
  };
  cluster: string;
  generatedAtIso8601: string;
  names: {
    agent: string;
    gaslessAgent: string;
    owner: string;
    wallet: string;
  };
  steps: MatrixStep[];
};

type MatrixArtifacts = {
  jsonPath: string;
  markdownPath: string;
};

type StepCounts = {
  fail: number;
  ok: number;
  skip: number;
  total: number;
  warn: number;
};

type CommandSuccess<T> = {
  payload: T;
  stderr: string;
  stdout: string;
};

const tsNodeBin = require.resolve("ts-node/dist/bin.js");
const includeProtocolLive = process.env.PRKT_DEVNET_MATRIX_INCLUDE_PROTOCOL_LIVE === "1";
const includeSensitiveExports = process.env.PRKT_DEVNET_MATRIX_INCLUDE_EXPORTS === "1";
const includeStress = process.env.PRKT_DEVNET_MATRIX_INCLUDE_STRESS === "1";
const matrixCliHome = path.join(process.cwd(), ".prkt-devnet-matrix");
const MATRIX_WALLET_FUNDING_SOL = 0.4;
const MATRIX_AGENT_FUNDING_SOL = 0.2;

function createChildEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PRKT_CLI_HOME: matrixCliHome,
    ...(extra ?? {})
  };
}

function recordStep(steps: MatrixStep[], step: MatrixStep): void {
  steps.push(step);
  const marker = step.status.toUpperCase().padEnd(4, " ");
  console.log(`[${marker}] ${step.category} :: ${step.name} -> ${step.detail}`);
}

function failStep(steps: MatrixStep[], category: string, name: string, detail: string): never {
  recordStep(steps, {
    category,
    detail,
    name,
    status: "fail"
  });
  throw new Error(`${category}/${name}: ${detail}`);
}

export function extractJsonPayload(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    throw new Error("command produced no stdout");
  }

  const candidateIndexes: number[] = [];
  for (let index = 0; index < trimmed.length; index += 1) {
    const current = trimmed[index];
    if ((current === "{" || current === "[") && (index === 0 || trimmed[index - 1] === "\n")) {
      candidateIndexes.push(index);
    }
  }

  for (let index = candidateIndexes.length - 1; index >= 0; index -= 1) {
    const candidate = trimmed.slice(candidateIndexes[index]).trimStart();
    const extracted = extractLeadingJson(candidate);
    if (!extracted) {
      continue;
    }

    try {
      return JSON.parse(extracted) as unknown;
    } catch {
      // Continue searching.
    }
  }

  throw new Error("unable to parse JSON payload from stdout");
}

function extractLeadingJson(candidate: string): string | null {
  const opening = candidate[0];
  const closing = opening === "{" ? "}" : opening === "[" ? "]" : null;
  if (!closing) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = 0; index < candidate.length; index += 1) {
    const current = candidate[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (current === "\\") {
        isEscaped = true;
        continue;
      }

      if (current === "\"") {
        inString = false;
      }

      continue;
    }

    if (current === "\"") {
      inString = true;
      continue;
    }

    if (current === opening) {
      depth += 1;
      continue;
    }

    if (current === closing) {
      depth -= 1;
      if (depth === 0) {
        return candidate.slice(0, index + 1);
      }
    }
  }

  return null;
}

function runTsNodeCommand(input: {
  args?: string[];
  env?: NodeJS.ProcessEnv;
  file: string;
}): CommandSuccess<unknown> {
  const result = spawnSync(
    process.execPath,
    [tsNodeBin, input.file, ...(input.args ?? [])],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: createChildEnv(input.env)
    }
  );

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "command failed").trim());
  }

  return {
    payload: extractJsonPayload(result.stdout),
    stderr: result.stderr,
    stdout: result.stdout
  };
}

function runScriptStep(input: {
  args?: string[];
  category: string;
  env?: NodeJS.ProcessEnv;
  file: string;
  name: string;
  optional?: boolean;
  steps: MatrixStep[];
}): { ok: boolean; stdout: string } {
  const result = spawnSync(
    process.execPath,
    [tsNodeBin, input.file, ...(input.args ?? [])],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: createChildEnv(input.env)
    }
  );

  if (result.status === 0) {
    recordStep(input.steps, {
      category: input.category,
      detail: "command completed",
      name: input.name,
      status: "ok"
    });
    return {
      ok: true,
      stdout: result.stdout
    };
  }

  recordStep(input.steps, {
    category: input.category,
    detail: (result.stderr || result.stdout || "command failed").trim(),
    name: input.name,
    status: input.optional ? "warn" : "fail"
  });
  if (!input.optional) {
    throw new Error(`${input.name} failed`);
  }

  return {
    ok: false,
    stdout: result.stdout
  };
}

function runCliJson<T>(args: string[]): T {
  const result = runTsNodeCommand({
    args: ["--json", ...args],
    file: "src/cli/index.ts"
  });
  return result.payload as T;
}

async function runAdvancedDevnetFlow(agentId: string): Promise<NonNullable<MatrixSummary["advanced"]>> {
  const originalCompression = { ...defaultPRKTConfig.zkCompression };
  const originalProofs = { ...defaultPRKTConfig.zkPolicyProofs };

  defaultPRKTConfig.zkCompression = {
    enabled: true,
    rpcEndpoint: getRpcUrl()
  };
  defaultPRKTConfig.zkPolicyProofs = {
    enabled: true
  };

  try {
    const keypair = Keypair.generate();
    const walletManager = WalletManager.fromSecretKey(keypair.secretKey, "generated");
    const rpcClient = new RpcClient(getRpcUrl(), "confirmed");
    const tokenService = new TokenService(rpcClient);
    const transactionService = new TransactionService(rpcClient);
    const balanceService = new BalanceService(rpcClient, tokenService);
    const fundingService = new DevnetFundingService(rpcClient, transactionService);
    await fundingService.ensureMinimumSol({
      balanceService,
      minimumSol: 0.05,
      recipient: walletManager.publicKey
    });
    await fundingService.waitForMinimumBalance({
      balanceService,
      minimumSol: 0.05,
      recipient: walletManager.publicKey
    });

    const policyManager = new PolicyAccountManager(getRpcUrl());
    const policyAccountSignature = await policyManager.createCompressedPolicyAccount(
      agentId,
      {
        dailySpendLimit: new BN(250_000_000),
        sessionTTL: 30,
        programAllowlist: [MEMO_PROGRAM_ID],
        killSwitchActive: false,
        spentToday: new BN(0),
        lastResetTimestamp: Date.now()
      },
      keypair
    );
    await policyManager.fetchCompressedPolicyAccount(agentId);

    const policyEngine = new PolicyEngine({
      agentId,
      approvalMode: "sandbox",
      limits: {
        maxSolPerTxLamports: 250_000_000,
        maxSplPerTxRawAmount: 1_000_000_000n,
        maxTransactionsPerDay: 10,
        maxTransactionsPerSession: 10
      },
      rules: {
        allowedMintAddresses: [],
        allowedProgramIds: [MEMO_PROGRAM_ID.toBase58()],
        denyUnknownInstructionsByDefault: true,
        rejectSuspiciousBalanceDeltas: true,
        requireSimulationSuccess: true
      },
      sessionExpiresAtIso8601: new Date(Date.now() + 30 * 60_000).toISOString()
    });
    const sandbox = new SandboxExecutor(policyEngine, transactionService, "sandbox");
    const built = await transactionService.buildTransaction({
      feePayer: walletManager.publicKey,
      instructions: [transactionService.buildMemoInstruction(`matrix:${agentId}`)],
      signer: walletManager
    });

    const sessionAnchor = new SessionAnchor(getRpcUrl(), walletManager);
    const auditLogManager = new AuditLogManager(getRpcUrl());
    const proofAnchor = new ProofAnchor(getRpcUrl(), walletManager);

    const sessionStart = await sessionAnchor.startSession(agentId);
    const executed = await sandbox.executePreparedTransaction({
      confirmationStrategy: built.confirmationStrategy,
      solanaKeypair: keypair,
      transaction: built.transaction
    });
    if (!executed.signature) {
      throw new Error("advanced devnet memo execution did not return a signature");
    }

    const auditLog = await auditLogManager.fetchAuditLog(agentId);
    const closed = await sessionAnchor.closeSession(sessionStart.sessionId, auditLog);
    const sessionVerification = await sessionAnchor.verifySession(sessionStart.sessionId, closed.commitment);
    if (!sessionVerification.valid) {
      throw new Error(`session verification failed: ${sessionVerification.reason ?? "unknown reason"}`);
    }

    const proofVerification = await proofAnchor.verifyProof(executed.signature);
    if (!proofVerification.valid) {
      throw new Error(`proof verification failed: ${proofVerification.reason ?? "unknown reason"}`);
    }

    return {
      agentId,
      commitment: closed.commitment,
      policyAccountSignature,
      proofSignature: executed.signature,
      sessionId: sessionStart.sessionId,
      sessionSignature: closed.closeSignature
    };
  } finally {
    defaultPRKTConfig.zkCompression = originalCompression;
    defaultPRKTConfig.zkPolicyProofs = originalProofs;
  }
}

export function createIntentFile(agentPublicKey: string): string {
  const tempDir = path.join(os.tmpdir(), "prkt-devnet-matrix");
  mkdirSync(tempDir, { recursive: true });
  const intentPath = path.join(tempDir, `intent-${Date.now()}.json`);
  writeFileSync(
    intentPath,
    JSON.stringify({
      type: "transfer-sol",
      to: agentPublicKey,
      lamports: 1_000_000
    }, null, 2),
    "utf8"
  );
  return intentPath;
}

export function summarizeSteps(steps: MatrixStep[]): StepCounts {
  return steps.reduce<StepCounts>((counts, step) => {
    counts.total += 1;
    counts[step.status] += 1;
    return counts;
  }, {
    fail: 0,
    ok: 0,
    skip: 0,
    total: 0,
    warn: 0
  });
}

export function renderMarkdownReport(summary: MatrixSummary): string {
  const counts = summarizeSteps(summary.steps);
  const lines = [
    "# PRKT Devnet Feature Matrix",
    "",
    `Generated: ${summary.generatedAtIso8601}`,
    `Cluster: ${summary.cluster}`,
    `Overall: ${counts.fail === 0 ? "PASS" : "FAIL"} (${counts.ok} ok, ${counts.warn} warn, ${counts.skip} skip, ${counts.fail} fail)`,
    "",
    "## Entities",
    "",
    `- Wallet: ${summary.names.wallet}`,
    `- Agent: ${summary.names.agent}`,
    `- Owner: ${summary.names.owner}`,
    `- Gasless agent: ${summary.names.gaslessAgent}`
  ];

  if (summary.advanced) {
    lines.push(
      "",
      "## Advanced Devnet Proof Path",
      "",
      `- Session ID: ${summary.advanced.sessionId}`,
      `- Session close signature: ${summary.advanced.sessionSignature}`,
      `- Policy account signature: ${summary.advanced.policyAccountSignature}`,
      `- Proof signature: ${summary.advanced.proofSignature}`,
      `- Commitment: ${summary.advanced.commitment}`
    );
  }

  lines.push(
    "",
    "## Step Results",
    "",
    "| Category | Step | Status | Detail |",
    "| --- | --- | --- | --- |"
  );

  for (const step of summary.steps) {
    const escapedDetail = step.detail.replace(/\|/gu, "\\|");
    lines.push(`| ${step.category} | ${step.name} | ${step.status.toUpperCase()} | ${escapedDetail} |`);
  }

  return `${lines.join("\n")}\n`;
}

export function writeArtifacts(summary: MatrixSummary): MatrixArtifacts {
  const artifactDir = path.join(process.cwd(), "artifacts");
  mkdirSync(artifactDir, { recursive: true });
  const jsonPath = path.join(artifactDir, "devnet-feature-matrix.json");
  const markdownPath = path.join(artifactDir, "devnet-feature-matrix.md");
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2), "utf8");
  writeFileSync(markdownPath, renderMarkdownReport(summary), "utf8");
  return {
    jsonPath,
    markdownPath
  };
}

export async function runDevnetFeatureMatrix(): Promise<MatrixArtifacts> {
  const steps: MatrixStep[] = [];
  const rpcUrl = getRpcUrl();
  const cluster = detectClusterFromRpcUrl(rpcUrl);
  mkdirSync(matrixCliHome, { recursive: true });
  if (cluster !== "devnet") {
    failStep(steps, "preflight", "cluster", `expected devnet RPC, got ${cluster} (${rpcUrl})`);
  }
  recordStep(steps, {
    category: "preflight",
    detail: rpcUrl,
    name: "cluster",
    status: "ok"
  });
  recordStep(steps, {
    category: "preflight",
    detail: matrixCliHome,
    name: "cli-home",
    status: "ok"
  });

  const suffix = Date.now().toString().slice(-8);
  const ownerName = `matrix-owner-${suffix}`;
  const walletName = `matrix-wallet-${suffix}`;
  const agentName = `matrix-agent-${suffix}`;
  const gaslessAgent = `matrix-gasless-${suffix}`;

  const init = runCliJson<{ cliDataDir: string }>(["init"]);
  recordStep(steps, {
    category: "cli",
    detail: init.cliDataDir,
    name: "init",
    status: "ok"
  });

  const config = runCliJson<{ cluster: string }>(["config", "show"]);
  recordStep(steps, {
    category: "cli",
    detail: `cluster=${config.cluster}`,
    name: "config-show",
    status: config.cluster === "devnet" ? "ok" : "warn"
  });

  const doctor = runCliJson<Array<{ check: string; status: string }>>(["doctor"]);
  const doctorFailures = doctor.filter((entry) => entry.status === "fail");
  if (doctorFailures.length > 0) {
    failStep(steps, "cli", "doctor", doctorFailures.map((entry) => entry.check).join(", "));
  }
  recordStep(steps, {
    category: "cli",
    detail: `${doctor.length} checks`,
    name: "doctor",
    status: "ok"
  });

  const walletCreate = runCliJson<{ publicKey: string; recoveryKey: string }>([
    "wallet",
    "create",
    "--name",
    walletName
  ]);
  recordStep(steps, {
    category: "wallet",
    detail: walletCreate.publicKey,
    name: "create",
    status: "ok"
  });

  runCliJson(["wallet", "list"]);
  recordStep(steps, {
    category: "wallet",
    detail: "listed wallets",
    name: "list",
    status: "ok"
  });

  runCliJson(["wallet", "show", "--name", walletName]);
  recordStep(steps, {
    category: "wallet",
    detail: walletName,
    name: "show",
    status: "ok"
  });

  runCliJson(["wallet", "fund", "--name", walletName, "--sol", MATRIX_WALLET_FUNDING_SOL.toString()]);
  recordStep(steps, {
    category: "wallet",
    detail: `${MATRIX_WALLET_FUNDING_SOL.toFixed(1)} SOL requested`,
    name: "fund",
    status: "ok"
  });

  runCliJson(["wallet", "balance", "--name", walletName]);
  recordStep(steps, {
    category: "wallet",
    detail: walletName,
    name: "balance",
    status: "ok"
  });

  const tokenMint = runCliJson<{ mint: string }>([
    "token",
    "mint-demo",
    "--authority",
    walletName,
    "--decimals",
    "6",
    "--amount",
    "5"
  ]);
  recordStep(steps, {
    category: "token",
    detail: tokenMint.mint,
    name: "mint-demo",
    status: "ok"
  });

  runCliJson(["token", "create-ata", "--owner", walletName, "--mint", tokenMint.mint]);
  recordStep(steps, {
    category: "token",
    detail: "wallet ATA ensured",
    name: "create-ata-wallet",
    status: "ok"
  });

  runCliJson(["wallet", "balance-spl", "--name", walletName, "--mint", tokenMint.mint]);
  recordStep(steps, {
    category: "token",
    detail: tokenMint.mint,
    name: "balance-spl-wallet",
    status: "ok"
  });

  const agentCreate = runCliJson<{ publicKey: string; recoveryKey: string }>([
    "agent",
    "create",
    "--agent",
    agentName,
    "--owner",
    ownerName
  ]);
  recordStep(steps, {
    category: "agent",
    detail: agentCreate.publicKey,
    name: "create",
    status: "ok"
  });

  runCliJson(["agent", "list"]);
  recordStep(steps, {
    category: "agent",
    detail: "listed agents",
    name: "list",
    status: "ok"
  });

  runCliJson(["agent", "show", "--agent", agentName]);
  recordStep(steps, {
    category: "agent",
    detail: agentName,
    name: "show",
    status: "ok"
  });

  runCliJson(["agent", "fund", "--agent", agentName, "--sol", MATRIX_AGENT_FUNDING_SOL.toString()]);
  recordStep(steps, {
    category: "agent",
    detail: `${MATRIX_AGENT_FUNDING_SOL.toFixed(1)} SOL requested`,
    name: "fund",
    status: "ok"
  });

  runCliJson(["agent", "balance", "--agent", agentName]);
  recordStep(steps, {
    category: "agent",
    detail: agentName,
    name: "balance",
    status: "ok"
  });

  runCliJson(["token", "create-ata", "--owner", agentName, "--mint", tokenMint.mint]);
  recordStep(steps, {
    category: "token",
    detail: "agent ATA ensured",
    name: "create-ata-agent",
    status: "ok"
  });

  runCliJson([
    "wallet",
    "transfer-sol",
    "--from",
    walletName,
    "--to",
    agentCreate.publicKey,
    "--amount",
    "0.05"
  ]);
  recordStep(steps, {
    category: "wallet",
    detail: `to ${agentCreate.publicKey}`,
    name: "transfer-sol",
    status: "ok"
  });

  runCliJson([
    "wallet",
    "transfer-spl",
    "--from",
    walletName,
    "--to",
    agentCreate.publicKey,
    "--mint",
    tokenMint.mint,
    "--amount",
    "1"
  ]);
  recordStep(steps, {
    category: "token",
    detail: `mint ${tokenMint.mint}`,
    name: "transfer-spl",
    status: "ok"
  });

  runCliJson(["policy", "presets"]);
  recordStep(steps, {
    category: "policy",
    detail: "listed presets",
    name: "presets",
    status: "ok"
  });

  runCliJson(["policy", "show", "--agent", agentName]);
  recordStep(steps, {
    category: "policy",
    detail: agentName,
    name: "show",
    status: "ok"
  });

  runCliJson(["policy", "set-preset", "--agent", agentName, "--preset", "guarded-live"]);
  recordStep(steps, {
    category: "policy",
    detail: "guarded-live",
    name: "set-preset-live",
    status: "ok"
  });

  runCliJson(["policy", "set-preset", "--agent", agentName, "--preset", "auto-devnet-safe"]);
  recordStep(steps, {
    category: "policy",
    detail: "auto-devnet-safe",
    name: "set-preset-default",
    status: "ok"
  });

  runCliJson([
    "policy",
    "set-limits",
    "--agent",
    agentName,
    "--max-sol-per-tx-lamports",
    "200000000",
    "--max-transactions-per-session",
    "3",
    "--allowed-destinations",
    agentCreate.publicKey
  ]);
  recordStep(steps, {
    category: "policy",
    detail: "temporary overrides applied",
    name: "set-limits",
    status: "ok"
  });

  const intentPath = createIntentFile(agentCreate.publicKey);
  runCliJson(["policy", "validate-intent", "--agent", agentName, "--intent-file", intentPath]);
  recordStep(steps, {
    category: "policy",
    detail: path.basename(intentPath),
    name: "validate-intent",
    status: "ok"
  });

  runCliJson(["policy", "clear-overrides", "--agent", agentName]);
  recordStep(steps, {
    category: "policy",
    detail: "overrides cleared",
    name: "clear-overrides",
    status: "ok"
  });

  runCliJson(["agent", "run", "--agent", agentName, "--strategy", "memo-heartbeat"]);
  recordStep(steps, {
    category: "agent",
    detail: "memo-heartbeat",
    name: "run",
    status: "ok"
  });

  runCliJson(["agent", "logs", "--agent", agentName]);
  recordStep(steps, {
    category: "agent",
    detail: agentName,
    name: "logs",
    status: "ok"
  });

  runCliJson(["monitor", "overview"]);
  runCliJson(["monitor", "balances"]);
  runCliJson(["monitor", "txs"]);
  runCliJson(["monitor", "agents"]);
  recordStep(steps, {
    category: "monitor",
    detail: "overview/balances/txs/agents",
    name: "views",
    status: "ok"
  });

  runCliJson(["audit", "--limit", "50"]);
  recordStep(steps, {
    category: "audit",
    detail: "limit 50",
    name: "audit",
    status: "ok"
  });

  const advanced = await runAdvancedDevnetFlow(`matrix-advanced-${suffix}`);
  recordStep(steps, {
    category: "advanced",
    detail: advanced.proofSignature,
    name: "memo-proof-compression-session",
    status: "ok"
  });

  runCliJson(["verify-session", advanced.sessionId, "--commitment", advanced.commitment]);
  runCliJson(["verify-tx", advanced.proofSignature]);
  recordStep(steps, {
    category: "advanced",
    detail: "verify-session + verify-tx",
    name: "cli-verification",
    status: "ok"
  });

  const gaslessResult = runScriptStep({
    category: "gasless",
    env: {
      PRKT_AGENT_NAME: gaslessAgent,
      PRKT_OWNER_ID: ownerName
    },
    file: "src/scripts/runGaslessMemo.ts",
    name: "kora-memo",
    steps
  });
  recordStep(steps, {
    category: "gasless",
    detail: gaslessResult.stdout.includes("Mode: live") ? "live" : "mock",
    name: "kora-mode",
    status: "ok"
  });

  runScriptStep({
    category: "security",
    file: "src/scripts/simulateAttack.ts",
    name: "simulate-attack",
    steps
  });

  runScriptStep({
    category: "defi",
    file: "src/scripts/runDeFiSuite.ts",
    name: "defi-suite-simulated",
    steps
  });

  if (includeStress) {
    runScriptStep({
      category: "demo",
      file: "src/scripts/runStressTest.ts",
      name: "stress-agents",
      optional: true,
      steps
    });
    runScriptStep({
      category: "demo",
      file: "src/demo/scripts/runMultiAgentDevnetDemo.ts",
      name: "multi-agent-devnet",
      optional: true,
      steps
    });
  } else {
    recordStep(steps, {
      category: "demo",
      detail: "set PRKT_DEVNET_MATRIX_INCLUDE_STRESS=1 to run stress and multi-agent demos",
      name: "stress-agents",
      status: "skip"
    });
  }

  if (includeSensitiveExports) {
    runCliJson(["wallet", "export-secret", "--name", walletName, "--recovery-key", walletCreate.recoveryKey]);
    runCliJson(["agent", "export-wallet", "--agent", agentName, "--recovery-key", agentCreate.recoveryKey]);
    recordStep(steps, {
      category: "custody",
      detail: "wallet and agent export paths exercised",
      name: "sensitive-exports",
      status: "ok"
    });
  } else {
    recordStep(steps, {
      category: "custody",
      detail: "set PRKT_DEVNET_MATRIX_INCLUDE_EXPORTS=1 to exercise secret export commands",
      name: "sensitive-exports",
      status: "skip"
    });
  }

  if (includeProtocolLive) {
    const liveScripts: Array<{ file: string; name: string; args?: string[] }> = [
      { file: "src/scripts/runDevnetWalletDemo.ts", name: "wallet-devnet" },
      { file: "src/scripts/runAutonomousAgentWalletDevnet.ts", name: "autonomous-agent-wallet-devnet" },
      { file: "src/scripts/runAutonomousPortfolioDevnet.ts", name: "autonomous-portfolio-devnet" },
      { file: "src/scripts/runMarinadeDevnet.ts", name: "marinade-devnet", args: ["0.15"] },
      { file: "src/scripts/runOrcaLpDevnet.ts", name: "orca-devnet", args: ["0.05"] },
      { file: "src/scripts/runKaminoDevnet.ts", name: "kamino-devnet-deposit", args: ["deposit"] },
      { file: "src/scripts/runKaminoDevnet.ts", name: "kamino-devnet-borrow", args: ["borrow"] },
      { file: "src/scripts/runRaydiumLpDevnet.ts", name: "raydium-lp-devnet" }
    ];

    for (const script of liveScripts) {
      runScriptStep({
        args: script.args,
        category: "live",
        file: script.file,
        name: script.name,
        optional: true,
        steps
      });
    }
  } else {
    recordStep(steps, {
      category: "live",
      detail: "set PRKT_DEVNET_MATRIX_INCLUDE_PROTOCOL_LIVE=1 to attempt live protocol demos",
      name: "protocol-demos",
      status: "skip"
    });
  }

  runCliJson(["agent", "stop", "--agent", agentName]);
  recordStep(steps, {
    category: "agent",
    detail: agentName,
    name: "stop",
    status: "ok"
  });

  const summary: MatrixSummary = {
    advanced,
    cluster,
    generatedAtIso8601: new Date().toISOString(),
    names: {
      agent: agentName,
      gaslessAgent,
      owner: ownerName,
      wallet: walletName
    },
    steps
  };

  const artifacts = writeArtifacts(summary);
  console.log(`Artifact JSON: ${artifacts.jsonPath}`);
  console.log(`Artifact Markdown: ${artifacts.markdownPath}`);
  return artifacts;
}

async function main(): Promise<void> {
  await runDevnetFeatureMatrix();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Devnet feature matrix failed: ${message}`);
    process.exitCode = 1;
  });
}
