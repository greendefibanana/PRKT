import { KoraRpcClient } from "../../src/kora/KoraRpcClient";
import { KoraSigner } from "../../src/kora/KoraSigner";
import { WalletManager } from "../../src/wallet/WalletManager";
import { DeFiCoordinator } from "../../src/defi/DeFiCoordinator";

describe("DeFiCoordinator", () => {
  it("runs trade, staking, lp, lending, and borrowing strategies when conditions are favorable", async () => {
    const coordinator = new DeFiCoordinator(
      WalletManager.generate(),
      new KoraSigner(new KoraRpcClient("http://127.0.0.1:8080"), {
        mockMode: true
      })
    );

    const results = await coordinator.runFullSuite({
      borrowDemandUsdcAtomic: 3_000_000,
      buyThresholdUsd: 100,
      collateralSolLamports: 1_000_000_000,
      healthFactor: 2.2,
      idleSolLamports: 1_000_000_000,
      idleUsdcAtomic: 5_000_000,
      liquidityInRange: true,
      solPriceUsd: 95
    });

    expect(results).toHaveLength(5);
    expect(results.map((entry) => `${entry.protocol}:${entry.action}`).sort()).toEqual([
      "jupiter:trade",
      "kamino:borrow",
      "kamino:deposit",
      "marinade:stake",
      "raydium:add_liquidity"
    ]);
  });

  it("runs the dedicated borrowing strategy when collateral is healthy", async () => {
    const coordinator = new DeFiCoordinator(
      WalletManager.generate(),
      new KoraSigner(new KoraRpcClient("http://127.0.0.1:8080"), {
        mockMode: true
      })
    );

    const result = await coordinator.runBorrowingStrategy({
      borrowDemandUsdcAtomic: 3_000_000,
      collateralSolLamports: 1_000_000_000,
      healthFactor: 2.3
    });

    expect(result).not.toBeNull();
    expect(result?.protocol).toBe("kamino");
    expect(result?.action).toBe("borrow");
  });

  it("holds borrowing strategy when collateral is weak", async () => {
    const coordinator = new DeFiCoordinator(
      WalletManager.generate(),
      new KoraSigner(new KoraRpcClient("http://127.0.0.1:8080"), {
        mockMode: true
      })
    );

    const result = await coordinator.runBorrowingStrategy({
      borrowDemandUsdcAtomic: 3_000_000,
      collateralSolLamports: 100_000_000,
      healthFactor: 1.4
    });

    expect(result).toBeNull();
  });

  it("holds DeFi actions when conditions are not favorable", async () => {
    const coordinator = new DeFiCoordinator(
      WalletManager.generate(),
      new KoraSigner(new KoraRpcClient("http://127.0.0.1:8080"), {
        mockMode: true
      })
    );

    const results = await coordinator.runFullSuite({
      borrowDemandUsdcAtomic: 0,
      healthFactor: 1.1,
      idleSolLamports: 100_000_000,
      idleUsdcAtomic: 500_000,
      liquidityInRange: false
    });

    expect(results).toHaveLength(0);
  });
});
