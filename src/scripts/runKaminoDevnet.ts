import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { createDefaultAgentPolicy } from "../agent/policyFactory";
import { createDefaultPolicyConfig } from "../config/agentPolicies";
import { getRpcUrl } from "../config/env";
import { BalanceService } from "../core/balances/BalanceService";
import { DevnetFundingService } from "../core/funding/DevnetFundingService";
import { RpcClient } from "../core/rpc/RpcClient";
import { TokenService } from "../core/tokens/TokenService";
import { TransactionService } from "../core/transactions/TransactionService";
import { DeFiExecutor } from "../defi/DeFiExecutor";
import { loadKaminoLiveConfig } from "../defi/kamino/kaminoLiveConfig";
import { PROTOCOL_PRESETS } from "../defi/protocols";
import { prepareLiveKamino } from "../defi/universal/liveExecutors";
import { PolicyEngine, SandboxExecutor } from "../policy";
import type { WalletManager } from "../wallet/WalletManager";
import {
  ensureManagedAgentWalletFunding,
  getManagedAgentName,
  getManagedOwnerId,
  logManagedAgentWallet,
  resolveManagedAgentWallet
} from "./managedAgentWallet";
import { printDemoMode } from "./mode";
import { createKoraSigner } from "./shared";

const DEFAULT_AGENT_NAME = "kamino-live-devnet";

async function main(): Promise<void> {
  const action = parseAction(process.argv[2]);
  printDemoMode("LIVE", `Kamino ${action} transaction on configured cluster`);

  const rpcClient = new RpcClient(getRpcUrl(), "confirmed");
  const transactionService = new TransactionService(rpcClient);
  const tokenService = new TokenService(rpcClient);
  const balanceService = new BalanceService(rpcClient, tokenService);
  const fundingService = new DevnetFundingService(rpcClient, transactionService);
  const config = loadKaminoLiveConfig();
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
    minimumSol:
      action === "deposit"
        ? Number(config.actions.depositAmountRaw) / LAMPORTS_PER_SOL + 0.05
        : 0.05,
    publicKey: walletManager.publicKey
  });

  console.log("PRKT Kamino live demo");
  logManagedAgentWallet(managed);
  console.log(`Market: ${config.marketAddress}`);
  console.log(`Program: ${config.programId}`);
  console.log(`Action: ${action}`);
  console.log(
    `Amount (raw): ${action === "deposit" ? config.actions.depositAmountRaw : config.actions.borrowAmountRaw}`
  );

  try {
    const prepared = await prepareLiveKamino({
      intent: {
        action,
        amountLamports: 0,
        marketId: PROTOCOL_PRESETS.kamino.defaultMarketId,
        memo: `LIVE:KAMINO:${action}`,
        protocol: "kamino",
        slippageBps: 40
      },
      logger: (message) => console.log(`[kamino-live] ${message}`),
      walletManager
    });
    if (!prepared) {
      throw new Error("Kamino live execution was not prepared. Check ENABLE_LIVE_KAMINO and config.");
    }

    const policyEngine = new PolicyEngine(
      createDefaultPolicyConfig({
        allowOpaqueProgramIds: prepared.policyConfigPatch?.rules?.allowOpaqueProgramIds,
        agentId: managed.agent.name,
        allowedCloseAccountDestinations:
          prepared.policyConfigPatch?.rules?.allowedCloseAccountDestinations,
        approvalMode: "sandbox",
        extraAllowedProgramIds: prepared.policyConfigPatch?.rules?.allowedProgramIds ?? [config.programId]
      })
    );
    const sandboxExecutor = new SandboxExecutor(policyEngine, transactionService, "sandbox");
    const execution = await sandboxExecutor.executePreparedTransaction({
      confirmationStrategy: prepared.confirmationStrategy,
      inspectionContext: prepared.inspectionContext,
      transaction: prepared.transaction
    });
    if (!execution.signature) {
      const simulationLogs = execution.simulationLogs?.join(" | ");
      throw new Error(
        `Guarded Kamino execution blocked: ${
          summarizeKaminoFailure(execution.inspection.reasons.join("; "), simulationLogs) ||
          "unknown reason"
        }${
          simulationLogs ? ` | simulation logs: ${simulationLogs}` : ""
        }`
      );
    }

    if (prepared.verifyExecution) {
      await prepared.verifyExecution(execution.signature);
    }

    console.log("Mode: live");
    console.log(`Transaction signature: ${execution.signature}`);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : "unknown Kamino live error";
    const signature = await executeSimulatedKaminoFallback({
      action,
      walletManager
    });

    console.log("Mode: simulated-fallback");
    console.log(`Fallback reason: ${summarizeKaminoFailure(reason)}`);
    console.log(`Transaction signature: ${signature}`);
  }
}

function parseAction(rawValue: string | undefined): "borrow" | "deposit" {
  if (!rawValue || rawValue === "deposit") {
    return "deposit";
  }

  if (rawValue === "borrow") {
    return "borrow";
  }

  throw new Error(`Unsupported action '${rawValue}'. Use 'deposit' or 'borrow'.`);
}

export function summarizeKaminoFailure(reason: string, simulationLogs?: string): string {
  if (reason.includes("ReserveStale") || simulationLogs?.includes("ReserveStale")) {
    return "reserve refresh is currently broken on the selected devnet market";
  }

  if (reason.includes("InvalidOracleConfig") || simulationLogs?.includes("InvalidOracleConfig")) {
    return "the selected devnet market has invalid oracle configuration";
  }

  return reason;
}

async function executeSimulatedKaminoFallback(input: {
  action: "borrow" | "deposit";
  walletManager: WalletManager;
}): Promise<string> {
  const executor = new DeFiExecutor(
    createDefaultAgentPolicy({
      maxSpend: {
        lamports: 1_000_000_000
      }
    })
  );
  const result = await executor.executeIntent({
    intent: {
      action: input.action,
      amountLamports: 0,
      expectedHealthFactor: input.action === "borrow" ? 2.2 : 2.0,
      marketId: PROTOCOL_PRESETS.kamino.defaultMarketId,
      memo: `DEFI_INTENT:KAMINO:${input.action}:DEVNET_FALLBACK`,
      protocol: "kamino",
      slippageBps: 40
    },
    koraSigner: createKoraSigner(),
    walletManager: input.walletManager
  });

  return result.signature;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Kamino live demo failed: ${message}`);
    process.exitCode = 1;
  });
}
