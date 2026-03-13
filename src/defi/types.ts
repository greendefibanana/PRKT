import type { SupportedProtocol } from "../types/policy";

export type DeFiAction =
  | "trade"
  | "stake"
  | "unstake"
  | "add_liquidity"
  | "remove_liquidity"
  | "harvest"
  | "deposit"
  | "withdraw"
  | "borrow"
  | "repay";

export type DeFiIntent = {
  action: DeFiAction;
  amountLamports: number;
  expectedHealthFactor?: number;
  marketId: string;
  memo: string;
  protocol: SupportedProtocol;
  slippageBps: number;
};

export type MarketSnapshot = {
  borrowDemandUsdcAtomic?: number;
  buyThresholdUsd?: number;
  collateralSolLamports?: number;
  healthFactor?: number;
  idleSolLamports?: number;
  idleUsdcAtomic?: number;
  liquidityInRange?: boolean;
  rewardsClaimableAtomic?: number;
  solPriceUsd?: number;
};

export type DeFiExecutionResult = {
  action: DeFiAction;
  memo: string;
  mock: boolean;
  protocol: SupportedProtocol;
  signature: string;
};

export type LpPositionSettings = {
  harvestThresholdAtomic: number;
  maxCapitalLamports: number;
  maxSlippageBps: number;
  poolId: string;
  rebalanceOnOutOfRange: boolean;
  tokenPair: string;
};

export type LpInstructionPlan = {
  action: "add_liquidity" | "remove_liquidity" | "harvest";
  amountLamports: number;
  operatorSummary: string;
  poolId: string;
  protocol: "raydium";
  requiredAccounts: string[];
  slippageBps: number;
  tokenPair: string;
};

export type RaydiumLiquidityPoolConfig = {
  authority: string;
  baseVault: string;
  lpMint: string;
  marketEventQueue: string;
  marketId: string;
  openOrders: string;
  poolId: string;
  poolType: "Standard" | "StablePool";
  programId: string;
  quoteVault: string;
  targetOrders: string;
};

export type RaydiumUserTokenAccounts = {
  baseTokenAccount: string;
  lpTokenAccount: string;
  quoteTokenAccount: string;
};
