import type { LpInstructionPlan, LpPositionSettings, MarketSnapshot } from "../types";

export interface LpInstructionBuilder {
  buildAddLiquidityPlan(input: {
    depositLamports: number;
    settings: LpPositionSettings;
  }): LpInstructionPlan;
  buildHarvestFeesPlan(input: {
    settings: LpPositionSettings;
    snapshot: MarketSnapshot;
  }): LpInstructionPlan | null;
  buildRemoveLiquidityPlan(input: {
    withdrawLamports: number;
    settings: LpPositionSettings;
  }): LpInstructionPlan;
}
