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

const DEFAULT_AGENT_NAME = "borrow-strategy";

async function main(): Promise<void> {
  printDemoMode("SIMULATED", "Protocol intent only (memo execution), not live Kamino borrow instructions");

  const managed = resolveManagedAgentWallet({
    agentName: getManagedAgentName({ defaultAgentName: DEFAULT_AGENT_NAME, env: process.env }),
    ownerId: getManagedOwnerId(process.env)
  });
  const coordinator = new DeFiCoordinator(
    managed.walletManager,
    createKoraSigner(),
    createRuntimeLogger("borrow")
  );
  logManagedAgentWallet(managed);

  const result = await coordinator.runBorrowingStrategy({
    borrowDemandUsdcAtomic: 3_000_000,
    collateralSolLamports: Math.round(1.2 * LAMPORTS_PER_SOL),
    healthFactor: 2.3
  });

  console.log("Borrow strategy complete.");
  if (!result) {
    console.log("No borrowing action executed.");
    return;
  }

  console.log(`Protocol: ${result.protocol}`);
  console.log(`Action: ${result.action}`);
  console.log(`Signature: ${result.signature}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Borrow strategy failed: ${message}`);
  process.exitCode = 1;
});
