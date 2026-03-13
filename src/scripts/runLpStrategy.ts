import { DeFiCoordinator } from "../defi/DeFiCoordinator";
import {
  getManagedAgentName,
  getManagedOwnerId,
  logManagedAgentWallet,
  resolveManagedAgentWallet
} from "./managedAgentWallet";
import { createKoraSigner, createRuntimeLogger } from "./shared";
import { printDemoMode } from "./mode";

const DEFAULT_AGENT_NAME = "lp-strategy";

async function main(): Promise<void> {
  printDemoMode("SIMULATED", "Protocol intent only (memo execution), not live Raydium LP instructions");

  const managed = resolveManagedAgentWallet({
    agentName: getManagedAgentName({ defaultAgentName: DEFAULT_AGENT_NAME, env: process.env }),
    ownerId: getManagedOwnerId(process.env)
  });
  const coordinator = new DeFiCoordinator(
    managed.walletManager,
    createKoraSigner(),
    createRuntimeLogger("lp")
  );
  logManagedAgentWallet(managed);

  const result = await coordinator.runLiquidityStrategy({
    liquidityInRange: true
  });

  console.log("LP strategy complete.");
  if (!result) {
    console.log("No liquidity action executed.");
    return;
  }

  console.log(`Protocol: ${result.protocol}`);
  console.log(`Action: ${result.action}`);
  console.log(`Signature: ${result.signature}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`LP strategy failed: ${message}`);
  process.exitCode = 1;
});
