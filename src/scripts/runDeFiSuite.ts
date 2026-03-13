import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { DeFiCoordinator } from "../defi/DeFiCoordinator";
import {
  getManagedAgentName,
  getManagedOwnerId,
  logManagedAgentWallet,
  resolveManagedAgentWallet
} from "./managedAgentWallet";
import { createKoraSigner, createRuntimeLogger } from "./shared";
import { printDemoMode } from "./mode";

const DEFAULT_AGENT_NAME = "defi-suite";

async function main(): Promise<void> {
  printDemoMode(
    "SIMULATED",
    "Protocol intents only (memo execution), not live Marinade/Raydium/Kamino instructions"
  );

  const managed = resolveManagedAgentWallet({
    agentName: getManagedAgentName({
      defaultAgentName: DEFAULT_AGENT_NAME,
      env: process.env
    }),
    ownerId: getManagedOwnerId(process.env)
  });

  const coordinator = new DeFiCoordinator(
    managed.walletManager,
    createKoraSigner(),
    createRuntimeLogger("defi")
  );

  logManagedAgentWallet(managed);

  const results = await coordinator.runFullSuite({
    buyThresholdUsd: 100,
    healthFactor: 2.2,
    idleSolLamports: Math.round(1.0 * LAMPORTS_PER_SOL),
    idleUsdcAtomic: 5_000_000,
    liquidityInRange: true,
    solPriceUsd: 95
  });

  console.log("DeFi suite complete.");
  if (results.length === 0) {
    console.log("No DeFi actions executed.");
    return;
  }

  for (const result of results) {
    console.log(`${result.protocol}: ${result.action} ${result.signature}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`DeFi suite failed: ${message}`);
  process.exitCode = 1;
});
