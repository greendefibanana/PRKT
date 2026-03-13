import { AgentManager } from "../agent/AgentManager";
import { MockPriceFeed } from "../agent/MockPriceFeed";
import { createLiveSwapConfig } from "./runtimeFactory";
import { createKoraSigner, createRuntimeLogger } from "./shared";
import { printDemoMode } from "./mode";

async function main(): Promise<void> {
  printDemoMode("SIMULATED", "Concurrent harness with per-agent rate limits and circuit breaker");
  const events = await AgentManager.runManagedTradeSimulation({
    amountSol: 0.01,
    koraSigner: createKoraSigner(),
    liveSwapConfig: createLiveSwapConfig(),
    logger: createRuntimeLogger("stress"),
    rounds: 5,
    safetyControls: {
      cooldownMs: 15_000,
      maxActionsPerWindow: 2,
      maxConsecutiveFailures: 2,
      windowMs: 20_000
    },
    priceFeed: new MockPriceFeed({
      buyThresholdUsd: 100,
      solPriceUsd: 92,
      usdcPriceUsd: 1
    })
  });

  console.log("Managed stress run complete.");
  for (const event of events) {
    if (event.status === "executed") {
      console.log(
        `${event.agentId}#${event.iteration}: ${event.result.action} ${
          event.result.execution?.signature ?? "NOOP"
        }`
      );
      continue;
    }

    console.log(`${event.agentId}#${event.iteration}: ${event.status} (${event.reason})`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Stress test failed: ${message}`);
  process.exitCode = 1;
});
