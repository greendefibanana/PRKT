import { KoraRpcClient } from "../../src/kora/KoraRpcClient";
import { KoraSigner } from "../../src/kora/KoraSigner";
import { WalletManager } from "../../src/wallet/WalletManager";
import { UniversalDeFiOrchestrator } from "../../src/defi/universal";

describe("UniversalDeFiOrchestrator", () => {
  it("routes universal capabilities to protocol adapters", async () => {
    const orchestrator = new UniversalDeFiOrchestrator({
      koraSigner: new KoraSigner(new KoraRpcClient("http://127.0.0.1:8080"), {
        mockMode: true
      }),
      liveFirst: false,
      walletManager: WalletManager.generate()
    });

    const results = await orchestrator.executeBatch([
      {
        capability: "trade",
        snapshot: {
          buyThresholdUsd: 100,
          solPriceUsd: 95
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
          healthFactor: 2.1,
          idleUsdcAtomic: 5_000_000
        }
      },
      {
        capability: "borrowing",
        protocol: "kamino",
        snapshot: {
          borrowDemandUsdcAtomic: 3_000_000,
          collateralSolLamports: 1_000_000_000,
          healthFactor: 2.3
        }
      }
    ]);

    expect(results).toHaveLength(4);
    expect(results.every((entry) => entry.result !== null)).toBe(true);
    expect(results.map((entry) => `${entry.protocol}:${entry.result?.action}`).sort()).toEqual([
      "jupiter:trade",
      "kamino:borrow",
      "kamino:deposit",
      "raydium:add_liquidity"
    ]);
  });
});
