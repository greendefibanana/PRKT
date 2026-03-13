import { PolicyGuard } from "../../src/policy/PolicyGuard";
import { MockPriceFeed } from "../../src/agent/MockPriceFeed";
import { simulateMarketAction } from "../../src/agent/AgentRuntime";
import { createDefaultAgentPolicy } from "../../src/agent/policyFactory";
import { KoraRpcClient } from "../../src/kora/KoraRpcClient";
import { KoraSigner } from "../../src/kora/KoraSigner";
import { WalletManager } from "../../src/wallet/WalletManager";

describe("simulateMarketAction", () => {
  it("executes a gasless swap intent when the price is favorable", async () => {
    const result = await simulateMarketAction({
      amountSol: 0.01,
      koraSigner: new KoraSigner(new KoraRpcClient("http://127.0.0.1:8080"), {
        mockMode: true
      }),
      policyGuard: new PolicyGuard(createDefaultAgentPolicy()),
      priceFeed: new MockPriceFeed({
        buyThresholdUsd: 100,
        solPriceUsd: 90,
        usdcPriceUsd: 1
      }),
      walletManager: WalletManager.generate()
    });

    expect(result.action).toBe("execute_swap");
    expect(result.execution?.mock).toBe(true);
    expect(result.memo).toContain("SWAP_INTENT");
  });

  it("holds when the mock price is above the buy threshold", async () => {
    const result = await simulateMarketAction({
      amountSol: 0.01,
      koraSigner: new KoraSigner(new KoraRpcClient("http://127.0.0.1:8080"), {
        mockMode: true
      }),
      policyGuard: new PolicyGuard(createDefaultAgentPolicy()),
      priceFeed: new MockPriceFeed({
        buyThresholdUsd: 100,
        solPriceUsd: 120,
        usdcPriceUsd: 1
      }),
      walletManager: WalletManager.generate()
    });

    expect(result.action).toBe("hold");
    expect(result.execution).toBeNull();
  });
});
