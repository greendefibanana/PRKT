import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { createDefaultPolicyConfig } from "../config/agentPolicies";
import { detectClusterFromRpcUrl, getRpcUrl } from "../config/env";
import { BalanceService } from "../core/balances/BalanceService";
import { DevnetFundingService } from "../core/funding/DevnetFundingService";
import { RpcClient } from "../core/rpc/RpcClient";
import { TokenService } from "../core/tokens/TokenService";
import { TransactionService } from "../core/transactions/TransactionService";
import { PROTOCOL_PRESETS } from "../defi/protocols";
import { prepareLiveMarinade } from "../defi/universal/liveExecutors";
import { PolicyEngine, SandboxExecutor } from "../policy";
import {
  ensureManagedAgentWalletFunding,
  getManagedAgentName,
  getManagedOwnerId,
  logManagedAgentWallet,
  resolveManagedAgentWallet
} from "./managedAgentWallet";
import { printDemoMode } from "./mode";

const DEFAULT_AGENT_NAME = "marinade-live-devnet";

async function main(): Promise<void> {
  const amountLamports = parseAmountLamports(process.argv[2]);
  printDemoMode("LIVE", `Marinade staking transaction on configured cluster (${amountLamports} lamports)`);

  const rpcUrl = getRpcUrl();
  const cluster = detectClusterFromRpcUrl(rpcUrl);
  if (cluster !== "devnet") {
    throw new Error(`Marinade live demo requires devnet. Current RPC cluster is ${cluster} (${rpcUrl}).`);
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

  await ensureManagedAgentWalletFunding({
    balanceService,
    fundingService,
    minimumSol: amountLamports / LAMPORTS_PER_SOL + 0.05,
    publicKey: walletManager.publicKey
  });

  const prepared = await prepareLiveMarinade({
    intent: {
      action: "stake",
      amountLamports,
      marketId: PROTOCOL_PRESETS.marinade.defaultMarketId,
      memo: `LIVE:MARINADE:stake:${amountLamports}`,
      protocol: "marinade",
      slippageBps: 25
    },
    logger: (message) => console.log(`[marinade-live] ${message}`),
    walletManager
  });
  if (!prepared) {
    throw new Error(
      "Marinade live execution was not prepared. Check ENABLE_LIVE_MARINADE and your RPC cluster."
    );
  }

  const policyEngine = new PolicyEngine(
    createDefaultPolicyConfig({
      agentId: managed.agent.name,
      allowOpaqueProgramIds: prepared.policyConfigPatch?.rules?.allowOpaqueProgramIds,
      approvalMode: "sandbox",
      extraAllowedProgramIds: prepared.policyConfigPatch?.rules?.allowedProgramIds
    })
  );
  const sandboxExecutor = new SandboxExecutor(policyEngine, transactionService, "sandbox");

  console.log("PRKT Marinade live demo");
  console.log(`RPC: ${rpcUrl}`);
  logManagedAgentWallet(managed);
  console.log(`Amount (lamports): ${amountLamports}`);

  const execution = await sandboxExecutor.executePreparedTransaction({
    confirmationStrategy: prepared.confirmationStrategy,
    inspectionContext: prepared.inspectionContext,
    transaction: prepared.transaction
  });
  if (!execution.signature) {
    throw new Error(
      `Guarded Marinade execution blocked: ${execution.inspection.reasons.join("; ") || "unknown reason"}`
    );
  }

  if (prepared.verifyExecution) {
    await prepared.verifyExecution(execution.signature);
  }

  console.log(`Transaction signature: ${execution.signature}`);
}

function parseAmountLamports(rawValue: string | undefined): number {
  if (!rawValue) {
    return Math.round(0.15 * LAMPORTS_PER_SOL);
  }

  const sol = Number(rawValue);
  if (!Number.isFinite(sol) || sol <= 0) {
    throw new Error(`Invalid SOL amount '${rawValue}'. Provide a positive decimal SOL amount.`);
  }

  return Math.round(sol * LAMPORTS_PER_SOL);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Marinade live demo failed: ${message}`);
  process.exitCode = 1;
});
