import { PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { makeAddLiquidityInstruction } from "@raydium-io/raydium-sdk-v2";

import { MOCK_BLOCKHASH } from "../../solana/programs";
import { WalletManager } from "../../wallet/WalletManager";
import type { LpInstructionBuilder } from "./LpInstructionBuilder";
import type {
  LpInstructionPlan,
  LpPositionSettings,
  MarketSnapshot,
  RaydiumLiquidityPoolConfig,
  RaydiumUserTokenAccounts
} from "../types";

export class RaydiumLpInstructionBuilder implements LpInstructionBuilder {
  buildAddLiquidityPlan(input: {
    depositLamports: number;
    settings: LpPositionSettings;
  }): LpInstructionPlan {
    return {
      action: "add_liquidity",
      amountLamports: Math.min(input.depositLamports, input.settings.maxCapitalLamports),
      operatorSummary: `Add liquidity on Raydium ${input.settings.tokenPair} with max slippage ${input.settings.maxSlippageBps} bps.`,
      poolId: input.settings.poolId,
      protocol: "raydium",
      requiredAccounts: [
        `${input.settings.poolId}:pool-state`,
        `${input.settings.poolId}:lp-vault`,
        `${input.settings.tokenPair}:token-a-ata`,
        `${input.settings.tokenPair}:token-b-ata`
      ],
      slippageBps: input.settings.maxSlippageBps,
      tokenPair: input.settings.tokenPair
    };
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
    const instruction = makeAddLiquidityInstruction({
      baseAmountIn: input.baseAmountIn,
      fixedSide: input.fixedSide ?? "base",
      otherAmountMin: input.otherAmountMin,
      poolInfo: {
        id: input.poolConfig.poolId,
        lpMint: {
          address: input.poolConfig.lpMint
        },
        marketId: input.poolConfig.marketId,
        pooltype: [input.poolConfig.poolType],
        programId: input.poolConfig.programId
      } as never,
      poolKeys: {
        authority: input.poolConfig.authority,
        marketEventQueue: input.poolConfig.marketEventQueue,
        openOrders: input.poolConfig.openOrders,
        targetOrders: input.poolConfig.targetOrders,
        vault: {
          A: input.poolConfig.baseVault,
          B: input.poolConfig.quoteVault
        }
      } as never,
      quoteAmountIn: input.quoteAmountIn,
      userKeys: {
        baseTokenAccount: new PublicKey(input.userTokenAccounts.baseTokenAccount),
        lpTokenAccount: new PublicKey(input.userTokenAccounts.lpTokenAccount),
        owner: input.owner.publicKey,
        quoteTokenAccount: new PublicKey(input.userTokenAccounts.quoteTokenAccount)
      }
    });

    const message = new TransactionMessage({
      payerKey: input.owner.publicKey,
      recentBlockhash: input.recentBlockhash ?? MOCK_BLOCKHASH,
      instructions: [instruction]
    }).compileToV0Message();

    const transaction = new VersionedTransaction(message);
    return input.owner.signTransaction(transaction);
  }

  buildHarvestFeesPlan(input: {
    settings: LpPositionSettings;
    snapshot: MarketSnapshot;
  }): LpInstructionPlan | null {
    const rewards = input.snapshot.rewardsClaimableAtomic ?? 0;
    if (rewards < input.settings.harvestThresholdAtomic) {
      return null;
    }

    return {
      action: "harvest",
      amountLamports: 0,
      operatorSummary: `Harvest accrued Raydium fees for ${input.settings.tokenPair}.`,
      poolId: input.settings.poolId,
      protocol: "raydium",
      requiredAccounts: [
        `${input.settings.poolId}:pool-state`,
        `${input.settings.poolId}:fee-vault`
      ],
      slippageBps: 0,
      tokenPair: input.settings.tokenPair
    };
  }

  buildRemoveLiquidityPlan(input: {
    withdrawLamports: number;
    settings: LpPositionSettings;
  }): LpInstructionPlan {
    return {
      action: "remove_liquidity",
      amountLamports: Math.min(input.withdrawLamports, input.settings.maxCapitalLamports),
      operatorSummary: `Remove liquidity from Raydium ${input.settings.tokenPair}.`,
      poolId: input.settings.poolId,
      protocol: "raydium",
      requiredAccounts: [
        `${input.settings.poolId}:pool-state`,
        `${input.settings.poolId}:lp-token-ata`
      ],
      slippageBps: input.settings.maxSlippageBps,
      tokenPair: input.settings.tokenPair
    };
  }
}
