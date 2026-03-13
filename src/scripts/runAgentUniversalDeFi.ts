import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { AgentRunner } from "../agent/runner/AgentRunner";
import { UniversalDeFiStrategy } from "../agent/strategies/UniversalDeFiStrategy";
import { createDefaultPolicyConfig } from "../config/agentPolicies";
import { getRpcUrl } from "../config/env";
import { BalanceService } from "../core/balances/BalanceService";
import { RpcClient } from "../core/rpc/RpcClient";
import { TokenService } from "../core/tokens/TokenService";
import { TransactionService } from "../core/transactions/TransactionService";
import { UniversalDeFiOrchestrator } from "../defi/universal";
import {
  getManagedAgentName,
  getManagedOwnerId,
  logManagedAgentWallet,
  resolveManagedAgentWallet
} from "./managedAgentWallet";
import { printDemoMode } from "./mode";
import { createKoraSigner } from "./shared";

const DEFAULT_AGENT_NAME = "agent-universal-defi";

async function main(): Promise<void> {
  printDemoMode(
    "SIMULATED",
    "AgentRunner universal DeFi flow (agent emits trade/lp/lending/borrowing/yield/staking intents)"
  );

  const rpcClient = new RpcClient(getRpcUrl(), "confirmed");
  const transactionService = new TransactionService(rpcClient);
  const tokenService = new TokenService(rpcClient);
  const managed = resolveManagedAgentWallet({
    agentName: getManagedAgentName({
      defaultAgentName: DEFAULT_AGENT_NAME,
      env: process.env
    }),
    ownerId: getManagedOwnerId(process.env)
  });
  const walletManager = managed.walletManager;
  const balanceService = new BalanceService(rpcClient, tokenService);
  const koraSigner = createKoraSigner();

  const universalDeFi = new UniversalDeFiOrchestrator({
    koraSigner,
    liveFirst: false,
    logger: (message) => console.log(`[universal-defi] ${message}`),
    walletManager
  });

  const runner = new AgentRunner();
  const agentId = managed.agent.name;

  logManagedAgentWallet(managed);

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
        agentId
      }),
      logger: (message) => console.log(`[${agentId}] ${message}`),
      universalDeFiExecutor: universalDeFi
    },
    strategy: new UniversalDeFiStrategy([
      {
        capability: "trade",
        snapshot: {
          buyThresholdUsd: 100,
          solPriceUsd: 95
        }
      },
      {
        capability: "staking",
        snapshot: {
          idleSolLamports: Math.round(1.0 * LAMPORTS_PER_SOL)
        }
      },
      {
        capability: "lp",
        snapshot: {
          liquidityInRange: true
        }
      },
      {
        capability: "lending",
        snapshot: {
          healthFactor: 2.0,
          idleUsdcAtomic: 5_000_000
        }
      },
      {
        capability: "borrowing",
        protocol: "kamino",
        snapshot: {
          borrowDemandUsdcAtomic: 3_000_000,
          collateralSolLamports: Math.round(1.2 * LAMPORTS_PER_SOL),
          healthFactor: 2.3
        }
      },
      {
        capability: "yield",
        protocol: "raydium",
        snapshot: {
          rewardsClaimableAtomic: 750_000
        }
      }
    ])
  });

  const result = await runner.runOnceParallel();
  console.log("Agent universal DeFi run complete.");
  for (const agent of result) {
    for (const outcome of agent.outcomes) {
      const intentType = outcome.intent.type;
      const suffix = outcome.signature ? `signature=${outcome.signature}` : "HOLD";
      console.log(`${agent.agentId} ${intentType} -> ${suffix}`);
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Agent universal DeFi run failed: ${message}`);
  process.exitCode = 1;
});
