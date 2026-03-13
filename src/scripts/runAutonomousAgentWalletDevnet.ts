import { Marinade, MarinadeConfig } from "@marinade.finance/marinade-ts-sdk";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { AgentRunner } from "../agent/runner/AgentRunner";
import { UniversalDeFiStrategy } from "../agent/strategies/UniversalDeFiStrategy";
import { createDefaultPolicyConfig } from "../config/agentPolicies";
import { detectClusterFromRpcUrl, getRpcUrl } from "../config/env";
import { BalanceService } from "../core/balances/BalanceService";
import { DevnetFundingService } from "../core/funding/DevnetFundingService";
import { RpcClient } from "../core/rpc/RpcClient";
import { TokenService } from "../core/tokens/TokenService";
import { TransactionService } from "../core/transactions/TransactionService";
import { UniversalDeFiOrchestrator } from "../defi/universal";
import {
  ensureManagedAgentWalletFunding,
  getManagedAgentName,
  getManagedOwnerId,
  logManagedAgentWallet,
  resolveManagedAgentWallet
} from "./managedAgentWallet";
import { printDemoMode } from "./mode";
import { createKoraSigner, createRuntimeLogger } from "./shared";

const DEFAULT_AGENT_NAME = "agent-autonomous-wallet";
const REQUIRED_FUNDING_SOL = 0.3;
const DEFAULT_STAKE_SOL = 0.15;

async function main(): Promise<void> {
  printDemoMode(
    "LIVE",
    "Autonomous agent wallet: provision or load the assigned agent wallet, fund on devnet, execute live Marinade stake, and verify owner stop control"
  );

  const rpcUrl = getRpcUrl();
  const cluster = detectClusterFromRpcUrl(rpcUrl);
  if (cluster !== "devnet") {
    throw new Error(
      `Autonomous agent wallet demo requires devnet. Current RPC cluster is ${cluster} (${rpcUrl}).`
    );
  }

  const rpcClient = new RpcClient(rpcUrl, "confirmed");
  const tokenService = new TokenService(rpcClient);
  const balanceService = new BalanceService(rpcClient, tokenService);
  const transactionService = new TransactionService(rpcClient);
  const fundingService = new DevnetFundingService(rpcClient, transactionService);
  const managed = resolveManagedAgentWallet({
    agentName: getManagedAgentName({
      defaultAgentName: DEFAULT_AGENT_NAME,
      env: process.env
    }),
    ownerId: getManagedOwnerId(process.env)
  });
  const walletManager = managed.walletManager;
  const logger = createRuntimeLogger("autonomous-agent");
  const agentId = managed.agent.name;

  console.log("PRKT autonomous agent wallet demo");
  console.log(`RPC: ${rpcUrl}`);
  logManagedAgentWallet(managed);

  await ensureManagedAgentWalletFunding({
    balanceService,
    fundingService,
    minimumSol: REQUIRED_FUNDING_SOL,
    publicKey: walletManager.publicKey
  });

  const marinade = new Marinade(
    new MarinadeConfig({
      connection: rpcClient.connection,
      publicKey: walletManager.publicKey
    })
  );
  const marinadeState = await marinade.getMarinadeState();
  const msolMint = marinadeState.mSolMintAddress;
  const solBefore = await balanceService.getSolBalance(walletManager.publicKey);
  const msolBefore = await balanceService.getSplTokenBalance({
    mint: msolMint,
    owner: walletManager.publicKey
  });

  const koraSigner = createKoraSigner();
  const universalDeFi = new UniversalDeFiOrchestrator({
    koraSigner,
    liveFirst: true,
    logger,
    walletManager
  });

  const runner = new AgentRunner();
  runner.registerAgent({
    context: {
      id: agentId,
      walletManager,
      walletPublicKey: walletManager.publicKey,
      rpcClient,
      transactionService,
      tokenService,
      balanceService,
      policyConfig: createDefaultPolicyConfig({
        agentId,
        maxSolPerTxLamports: Math.round(0.3 * LAMPORTS_PER_SOL),
        maxTransactionsPerDay: 10,
        maxTransactionsPerSession: 3
      }),
      logger,
      universalDeFiExecutor: universalDeFi
    },
    strategy: new UniversalDeFiStrategy([
      {
        capability: "staking",
        protocol: "marinade",
        snapshot: {
          idleSolLamports: Math.round(solBefore * LAMPORTS_PER_SOL)
        }
      }
    ]),
    approvalMode: "sandbox"
  });

  const [runResult] = await runner.runOnceParallel();
  if (!runResult) {
    throw new Error("Autonomous agent run did not produce a result.");
  }

  const [stakeOutcome] = runResult.outcomes;
  if (!stakeOutcome) {
    throw new Error("Autonomous agent produced no staking outcome.");
  }
  if (!stakeOutcome.allowed || !stakeOutcome.signature) {
    throw new Error(
      `Autonomous stake was blocked: ${stakeOutcome.reasons.join("; ") || "unknown reason"}`
    );
  }

  const solAfter = await balanceService.getSolBalance(walletManager.publicKey);
  const msolAfter = await balanceService.getSplTokenBalance({
    mint: msolMint,
    owner: walletManager.publicKey
  });
  if (msolAfter <= msolBefore) {
    throw new Error(
      `Autonomous stake verification failed: mSOL did not increase (${msolBefore.toFixed(6)} -> ${msolAfter.toFixed(6)}).`
    );
  }

  console.log("");
  console.log("Autonomous run");
  console.log(`Agent: ${agentId}`);
  console.log(`Intent: stake ${DEFAULT_STAKE_SOL.toFixed(2)} SOL via Marinade`);
  console.log(`Signature: ${stakeOutcome.signature}`);
  console.log(`SOL before: ${solBefore.toFixed(4)}`);
  console.log(`SOL after: ${solAfter.toFixed(4)}`);
  console.log(`mSOL before: ${msolBefore.toFixed(6)}`);
  console.log(`mSOL after: ${msolAfter.toFixed(6)}`);

  const originalEmergencyLock = process.env.POLICY_EMERGENCY_LOCK;
  process.env.POLICY_EMERGENCY_LOCK = "true";
  try {
    const [lockedRun] = await runner.runOnceParallel();
    const [lockedOutcome] = lockedRun?.outcomes ?? [];
    if (!lockedOutcome || lockedOutcome.allowed) {
      throw new Error("Emergency lock supervision check failed: agent execution was not blocked.");
    }

    console.log("");
    console.log("Owner supervision");
    console.log("Emergency lock engaged via POLICY_EMERGENCY_LOCK=true");
    console.log(`Blocked reasons: ${lockedOutcome.reasons.join("; ")}`);
  } finally {
    if (originalEmergencyLock === undefined) {
      delete process.env.POLICY_EMERGENCY_LOCK;
    } else {
      process.env.POLICY_EMERGENCY_LOCK = originalEmergencyLock;
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Autonomous agent wallet demo failed: ${message}`);
  process.exitCode = 1;
});
