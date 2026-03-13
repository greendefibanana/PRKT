import { PolicyGuard } from "../policy/PolicyGuard";
import { MockPriceFeed } from "../agent/MockPriceFeed";
import { simulateMarketAction } from "../agent/AgentRuntime";
import { createDefaultAgentPolicy } from "../agent/policyFactory";
import {
  getManagedAgentName,
  getManagedOwnerId,
  logManagedAgentWallet,
  resolveManagedAgentWallet
} from "./managedAgentWallet";
import { createLiveSwapConfig } from "./runtimeFactory";
import { createKoraSigner, createRuntimeLogger } from "./shared";
import { printDemoMode } from "./mode";

const DEFAULT_AGENT_NAME = "trade-loop";

async function main(): Promise<void> {
  const managed = resolveManagedAgentWallet({
    agentName: getManagedAgentName({ defaultAgentName: DEFAULT_AGENT_NAME, env: process.env }),
    ownerId: getManagedOwnerId(process.env)
  });
  const walletManager = managed.walletManager;
  const policy = createDefaultAgentPolicy();
  const policyGuard = new PolicyGuard(policy);
  const priceFeed = new MockPriceFeed({
    buyThresholdUsd: 100,
    solPriceUsd: 95,
    usdcPriceUsd: 1
  });

  const result = await simulateMarketAction({
    amountSol: 0.01,
    koraSigner: createKoraSigner(),
    liveSwapConfig: createLiveSwapConfig(),
    logger: createRuntimeLogger("trade"),
    policyGuard,
    priceFeed,
    walletManager
  });
  logManagedAgentWallet(managed);
  const mode = result.liveSwap && !result.execution?.mock ? "LIVE" : "SIMULATED";
  const detail =
    mode === "LIVE"
      ? "Jupiter route built and submitted"
      : "Memo intent and/or mock transport";
  printDemoMode(mode, detail);

  console.log(`Trade action: ${result.action}`);
  if (result.execution) {
    console.log(`Trade signature: ${result.execution.signature}`);
  }
  if (result.liveSwap) {
    console.log(`Trade route: ${result.liveSwap.routeType}`);
    console.log(`Quote out amount: ${result.liveSwap.quoteOutAmount}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Trade loop failed: ${message}`);
  process.exitCode = 1;
});
