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

const DEFAULT_AGENT_NAME = "stake-strategy";

async function main(): Promise<void> {
  printDemoMode("SIMULATED", "Protocol intent only (memo execution), not live Marinade instructions");

  const managed = resolveManagedAgentWallet({
    agentName: getManagedAgentName({ defaultAgentName: DEFAULT_AGENT_NAME, env: process.env }),
    ownerId: getManagedOwnerId(process.env)
  });
  const coordinator = new DeFiCoordinator(
    managed.walletManager,
    createKoraSigner(),
    createRuntimeLogger("stake")
  );
  logManagedAgentWallet(managed);

  const result = await coordinator.runStakingStrategy({
    idleSolLamports: Math.round(0.8 * LAMPORTS_PER_SOL)
  });

  console.log("Staking strategy complete.");
  if (!result) {
    console.log("No staking action executed.");
    return;
  }

  console.log(`Protocol: ${result.protocol}`);
  console.log(`Action: ${result.action}`);
  console.log(`Signature: ${result.signature}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Staking strategy failed: ${message}`);
  process.exitCode = 1;
});
