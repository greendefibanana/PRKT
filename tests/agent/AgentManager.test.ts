import { AgentManager } from "../../src/agent/AgentManager";
import { MockPriceFeed } from "../../src/agent/MockPriceFeed";
import { KoraRpcClient } from "../../src/kora/KoraRpcClient";
import { KoraSigner } from "../../src/kora/KoraSigner";

describe("AgentManager", () => {
  it("spawns three unique agents and runs them concurrently", async () => {
    const results = await AgentManager.runConcurrentTradeSimulation({
      amountSol: 0.01,
      koraSigner: new KoraSigner(new KoraRpcClient("http://127.0.0.1:8080"), {
        mockMode: true
      }),
      priceFeed: new MockPriceFeed({
        buyThresholdUsd: 100,
        solPriceUsd: 95,
        usdcPriceUsd: 1
      })
    });

    expect(results).toHaveLength(3);
    expect(new Set(results.map((entry) => entry.agentId)).size).toBe(3);
    expect(results.every((entry) => entry.result.action === "execute_swap")).toBe(true);
  });

  it("blocks agents when per-window rate limit is exceeded", async () => {
    const events = await AgentManager.runManagedTradeSimulation({
      amountSol: 0.01,
      koraSigner: new KoraSigner(new KoraRpcClient("http://127.0.0.1:8080"), {
        mockMode: true
      }),
      rounds: 3,
      safetyControls: {
        maxActionsPerWindow: 1,
        maxConsecutiveFailures: 5,
        windowMs: 60_000,
        cooldownMs: 60_000
      },
      simulateAction: async () => ({
        action: "execute_swap",
        execution: {
          endpoint: "mock",
          memo: "mock",
          mock: true,
          signature: "sig"
        },
        liveSwap: null,
        market: {
          buyThresholdUsd: 100,
          solPriceUsd: 90,
          usdcPriceUsd: 1
        },
        memo: "mock"
      }),
      priceFeed: new MockPriceFeed({
        buyThresholdUsd: 100,
        solPriceUsd: 95,
        usdcPriceUsd: 1
      })
    });

    const blocked = events.filter((event) => event.status === "blocked");
    expect(blocked.length).toBeGreaterThan(0);
    for (const event of blocked) {
      if (event.status === "blocked") {
        expect(event.reason.includes("rate limit exceeded")).toBe(true);
      }
    }
  });

  it("opens the circuit breaker after consecutive failures", async () => {
    const events = await AgentManager.runManagedTradeSimulation({
      amountSol: 0.01,
      koraSigner: new KoraSigner(new KoraRpcClient("http://127.0.0.1:8080"), {
        mockMode: true
      }),
      rounds: 3,
      safetyControls: {
        maxActionsPerWindow: 10,
        maxConsecutiveFailures: 1,
        windowMs: 60_000,
        cooldownMs: 60_000
      },
      simulateAction: async () => {
        throw new Error("simulated failure");
      },
      priceFeed: new MockPriceFeed({
        buyThresholdUsd: 100,
        solPriceUsd: 95,
        usdcPriceUsd: 1
      })
    });

    const blocked = events.filter((event) => event.status === "blocked");
    expect(blocked.length).toBeGreaterThan(0);
    for (const event of blocked) {
      if (event.status === "blocked") {
        expect(event.reason.includes("circuit breaker open")).toBe(true);
      }
    }
  });
});
