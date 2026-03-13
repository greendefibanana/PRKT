import { Keypair, TransactionMessage } from "@solana/web3.js";

import { WalletManager } from "../../src/wallet/WalletManager";
import { RaydiumLpInstructionBuilder } from "../../src/defi/lp/RaydiumLpInstructionBuilder";

describe("RaydiumLpInstructionBuilder", () => {
  it("builds an add-liquidity plan from operator settings", () => {
    const builder = new RaydiumLpInstructionBuilder();
    const plan = builder.buildAddLiquidityPlan({
      depositLamports: 120_000_000,
      settings: {
        harvestThresholdAtomic: 250_000,
        maxCapitalLamports: 200_000_000,
        maxSlippageBps: 75,
        poolId: "sol-usdc-core-pool",
        rebalanceOnOutOfRange: true,
        tokenPair: "SOL/USDC"
      }
    });

    expect(plan.action).toBe("add_liquidity");
    expect(plan.poolId).toBe("sol-usdc-core-pool");
    expect(plan.requiredAccounts).toContain("sol-usdc-core-pool:pool-state");
    expect(plan.slippageBps).toBe(75);
  });

  it("builds a harvest plan only when rewards exceed the threshold", () => {
    const builder = new RaydiumLpInstructionBuilder();
    const settings = {
      harvestThresholdAtomic: 250_000,
      maxCapitalLamports: 200_000_000,
      maxSlippageBps: 75,
      poolId: "sol-usdc-core-pool",
      rebalanceOnOutOfRange: true,
      tokenPair: "SOL/USDC"
    };

    expect(
      builder.buildHarvestFeesPlan({
        settings,
        snapshot: {
          rewardsClaimableAtomic: 100_000
        }
      })
    ).toBeNull();

    expect(
      builder.buildHarvestFeesPlan({
        settings,
        snapshot: {
          rewardsClaimableAtomic: 300_000
        }
      })?.action
    ).toBe("harvest");
  });

  it("builds a real Raydium add-liquidity transaction draft from explicit pool config", async () => {
    const builder = new RaydiumLpInstructionBuilder();
    const wallet = WalletManager.generate();
    const poolConfig = {
      authority: Keypair.generate().publicKey.toBase58(),
      baseVault: Keypair.generate().publicKey.toBase58(),
      lpMint: Keypair.generate().publicKey.toBase58(),
      marketEventQueue: Keypair.generate().publicKey.toBase58(),
      marketId: Keypair.generate().publicKey.toBase58(),
      openOrders: Keypair.generate().publicKey.toBase58(),
      poolId: Keypair.generate().publicKey.toBase58(),
      poolType: "Standard" as const,
      programId: Keypair.generate().publicKey.toBase58(),
      quoteVault: Keypair.generate().publicKey.toBase58(),
      targetOrders: Keypair.generate().publicKey.toBase58()
    };
    const userTokenAccounts = {
      baseTokenAccount: Keypair.generate().publicKey.toBase58(),
      lpTokenAccount: Keypair.generate().publicKey.toBase58(),
      quoteTokenAccount: Keypair.generate().publicKey.toBase58()
    };

    const transaction = await builder.buildAddLiquidityTransactionDraft({
      baseAmountIn: 100_000,
      otherAmountMin: 90_000,
      owner: wallet,
      poolConfig,
      quoteAmountIn: 100_000,
      userTokenAccounts
    });

    const decompiled = TransactionMessage.decompile(transaction.message);

    expect(decompiled.instructions).toHaveLength(1);
    expect(decompiled.instructions[0].programId.toBase58()).toBe(poolConfig.programId);
  });
});
