import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { RaydiumLpInstructionBuilder } from "../lp/RaydiumLpInstructionBuilder";
import { PROTOCOL_PRESETS } from "../protocols";
import type {
  DeFiIntent,
  LpInstructionPlan,
  LpPositionSettings,
  MarketSnapshot,
  RaydiumLiquidityPoolConfig,
  RaydiumUserTokenAccounts
} from "../types";
import { WalletManager } from "../../wallet/WalletManager";
import { VersionedTransaction } from "@solana/web3.js";

export class RaydiumAdapter {
  readonly protocol = "raydium" as const;
  private readonly lpInstructionBuilder = new RaydiumLpInstructionBuilder();

  createDefaultPositionSettings(): LpPositionSettings {
    return {
      harvestThresholdAtomic: 250_000,
      maxCapitalLamports: Math.round(0.2 * LAMPORTS_PER_SOL),
      maxSlippageBps: 80,
      poolId: PROTOCOL_PRESETS.raydium.defaultMarketId,
      rebalanceOnOutOfRange: true,
      tokenPair: "SOL/USDC"
    };
  }

  buildAddLiquidityPlan(settings?: LpPositionSettings): LpInstructionPlan {
    const resolvedSettings = settings ?? this.createDefaultPositionSettings();

    return this.lpInstructionBuilder.buildAddLiquidityPlan({
      depositLamports: Math.round(0.12 * LAMPORTS_PER_SOL),
      settings: resolvedSettings
    });
  }

  async buildAddLiquidityTransactionDraft(input: {
    baseAmountIn: number;
    fixedSide?: "base" | "quote";
    otherAmountMin: number;
    owner: WalletManager;
    poolConfig: RaydiumLiquidityPoolConfig;
    quoteAmountIn: number;
    recentBlockhash?: string;
    userTokenAccounts: RaydiumUserTokenAccounts;
  }): Promise<VersionedTransaction> {
    return this.lpInstructionBuilder.buildAddLiquidityTransactionDraft(input);
  }

  buildAddLiquidityIntent(snapshot: MarketSnapshot, settings?: LpPositionSettings): DeFiIntent | null {
    if (!snapshot.liquidityInRange) {
      return null;
    }

    const plan = this.buildAddLiquidityPlan(settings);

    return {
      action: plan.action,
      amountLamports: plan.amountLamports,
      marketId: plan.poolId,
      memo: `DEFI_INTENT:RAYDIUM:${plan.action}:${plan.tokenPair}`,
      protocol: this.protocol,
      slippageBps: plan.slippageBps
    };
  }
}
