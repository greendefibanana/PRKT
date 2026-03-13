import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { KaminoAdapter } from "../../src/defi/adapters/KaminoAdapter";
import { MarinadeAdapter } from "../../src/defi/adapters/MarinadeAdapter";
import { RaydiumAdapter } from "../../src/defi/adapters/RaydiumAdapter";

describe("Protocol adapters", () => {
  it("builds a Marinade stake intent when idle SOL exceeds reserve", () => {
    const adapter = new MarinadeAdapter();
    const intent = adapter.buildStakeIntent({
      idleSolLamports: Math.round(1 * LAMPORTS_PER_SOL)
    });

    expect(intent).not.toBeNull();
    expect(intent?.protocol).toBe("marinade");
    expect(intent?.action).toBe("stake");
  });

  it("does not build a Raydium LP intent when liquidity is out of range", () => {
    const adapter = new RaydiumAdapter();

    expect(
      adapter.buildAddLiquidityIntent({
        liquidityInRange: false
      })
    ).toBeNull();
  });

  it("builds a Raydium LP plan from operator settings", () => {
    const adapter = new RaydiumAdapter();
    const plan = adapter.buildAddLiquidityPlan({
      harvestThresholdAtomic: 300_000,
      maxCapitalLamports: 250_000_000,
      maxSlippageBps: 70,
      poolId: "custom-sol-usdc-pool",
      rebalanceOnOutOfRange: true,
      tokenPair: "SOL/USDC"
    });

    expect(plan.poolId).toBe("custom-sol-usdc-pool");
    expect(plan.slippageBps).toBe(70);
  });

  it("builds a Kamino deposit intent when idle USDC is sufficient", () => {
    const adapter = new KaminoAdapter();
    const intent = adapter.buildDepositIntent({
      healthFactor: 2,
      idleUsdcAtomic: 5_000_000
    });

    expect(intent).not.toBeNull();
    expect(intent?.protocol).toBe("kamino");
    expect(intent?.action).toBe("deposit");
  });

  it("builds a Kamino borrow intent when collateral and demand are sufficient", () => {
    const adapter = new KaminoAdapter();
    const intent = adapter.buildBorrowIntent({
      borrowDemandUsdcAtomic: 3_000_000,
      collateralSolLamports: Math.round(1 * LAMPORTS_PER_SOL),
      healthFactor: 2.3
    });

    expect(intent).not.toBeNull();
    expect(intent?.protocol).toBe("kamino");
    expect(intent?.action).toBe("borrow");
  });
});
