import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { UniversalDeFiOrchestrator } from "../defi/universal";
import {
  getManagedAgentName,
  getManagedOwnerId,
  logManagedAgentWallet,
  resolveManagedAgentWallet
} from "./managedAgentWallet";
import { createKoraSigner, createRuntimeLogger } from "./shared";
import { printDemoMode } from "./mode";

const DEFAULT_AGENT_NAME = "universal-defi-demo";

async function main(): Promise<void> {
  printDemoMode(
    "SIMULATED",
    "Universal DeFi compatibility mode (trade/lp/lending/borrowing/yield/staking routed by adapter registry)"
  );

  const managed = resolveManagedAgentWallet({
    agentName: getManagedAgentName({
      defaultAgentName: DEFAULT_AGENT_NAME,
      env: process.env
    }),
    ownerId: getManagedOwnerId(process.env)
  });

  const orchestrator = new UniversalDeFiOrchestrator({
    koraSigner: createKoraSigner(),
    liveFirst: false,
    logger: createRuntimeLogger("universal-defi"),
    walletManager: managed.walletManager
  });

  logManagedAgentWallet(managed);

  const requests = [
    {
      capability: "trade" as const,
      snapshot: {
        buyThresholdUsd: 100,
        solPriceUsd: 95
      }
    },
    {
      capability: "staking" as const,
      snapshot: {
        idleSolLamports: Math.round(1.0 * LAMPORTS_PER_SOL)
      }
    },
    {
      capability: "lp" as const,
      snapshot: {
        liquidityInRange: true
      }
    },
    {
      capability: "lending" as const,
      snapshot: {
        healthFactor: 2.0,
        idleUsdcAtomic: 5_000_000
      }
    },
    {
      capability: "borrowing" as const,
      protocol: "kamino" as const,
      snapshot: {
        borrowDemandUsdcAtomic: 3_000_000,
        collateralSolLamports: Math.round(1.2 * LAMPORTS_PER_SOL),
        healthFactor: 2.3
      }
    },
    {
      capability: "yield" as const,
      protocol: "kamino" as const,
      snapshot: {
        healthFactor: 2.1,
        idleUsdcAtomic: 4_000_000
      }
    }
  ];

  const results = await orchestrator.executeBatch(requests);
  console.log("Universal DeFi run complete.");
  for (const entry of results) {
    if (!entry.result) {
      console.log(`${entry.capability}/${entry.protocol}: HOLD`);
      continue;
    }
    console.log(
      `${entry.capability}/${entry.protocol}: ${entry.result.action} ${entry.result.signature}`
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Universal DeFi demo failed: ${message}`);
  process.exitCode = 1;
});
