import { existsSync, readFileSync } from "fs";
import path from "path";

import { PublicKey } from "@solana/web3.js";

import { getRaydiumLpConfigPath } from "../../config/env";
import type { RaydiumLiquidityPoolConfig, RaydiumUserTokenAccounts } from "../types";

export type RaydiumLpDevnetConfig = {
  amounts: {
    baseAmountIn: number;
    otherAmountMin: number;
    quoteAmountIn: number;
  };
  poolConfig: RaydiumLiquidityPoolConfig;
  userTokenAccounts: RaydiumUserTokenAccounts;
};

export function loadRaydiumLpDevnetConfig(): RaydiumLpDevnetConfig {
  const configPath = path.resolve(process.cwd(), getRaydiumLpConfigPath());
  if (!existsSync(configPath)) {
    throw new Error(
      `Raydium LP config not found at ${configPath}. Create raydium_lp.devnet.json from the example file first.`
    );
  }

  const raw = readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<RaydiumLpDevnetConfig>;

  const config: RaydiumLpDevnetConfig = {
    amounts: {
      baseAmountIn: parsePositiveInteger(parsed.amounts?.baseAmountIn, "amounts.baseAmountIn"),
      otherAmountMin: parsePositiveInteger(parsed.amounts?.otherAmountMin, "amounts.otherAmountMin"),
      quoteAmountIn: parsePositiveInteger(parsed.amounts?.quoteAmountIn, "amounts.quoteAmountIn")
    },
    poolConfig: {
      authority: parsePublicKey(parsed.poolConfig?.authority, "poolConfig.authority"),
      baseVault: parsePublicKey(parsed.poolConfig?.baseVault, "poolConfig.baseVault"),
      lpMint: parsePublicKey(parsed.poolConfig?.lpMint, "poolConfig.lpMint"),
      marketEventQueue: parsePublicKey(
        parsed.poolConfig?.marketEventQueue,
        "poolConfig.marketEventQueue"
      ),
      marketId: parsePublicKey(parsed.poolConfig?.marketId, "poolConfig.marketId"),
      openOrders: parsePublicKey(parsed.poolConfig?.openOrders, "poolConfig.openOrders"),
      poolId: parsePublicKey(parsed.poolConfig?.poolId, "poolConfig.poolId"),
      poolType: parsePoolType(parsed.poolConfig?.poolType),
      programId: parsePublicKey(parsed.poolConfig?.programId, "poolConfig.programId"),
      quoteVault: parsePublicKey(parsed.poolConfig?.quoteVault, "poolConfig.quoteVault"),
      targetOrders: parsePublicKey(parsed.poolConfig?.targetOrders, "poolConfig.targetOrders")
    },
    userTokenAccounts: {
      baseTokenAccount: parsePublicKey(
        parsed.userTokenAccounts?.baseTokenAccount,
        "userTokenAccounts.baseTokenAccount"
      ),
      lpTokenAccount: parsePublicKey(
        parsed.userTokenAccounts?.lpTokenAccount,
        "userTokenAccounts.lpTokenAccount"
      ),
      quoteTokenAccount: parsePublicKey(
        parsed.userTokenAccounts?.quoteTokenAccount,
        "userTokenAccounts.quoteTokenAccount"
      )
    }
  };

  return config;
}

function parsePositiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }

  return value as number;
}

function parsePoolType(value: unknown): "Standard" | "StablePool" {
  if (value === "Standard" || value === "StablePool") {
    return value;
  }

  throw new Error("poolConfig.poolType must be either 'Standard' or 'StablePool'.");
}

function parsePublicKey(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a base58 public key string.`);
  }

  return new PublicKey(value).toBase58();
}
