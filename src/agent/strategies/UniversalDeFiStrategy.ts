import type { AgentIntent } from "../intents/types";
import type { AgentContext, Strategy } from "../types/AgentContext";

export class UniversalDeFiStrategy implements Strategy {
  readonly name = "universal-defi";

  constructor(
    private readonly requests: Array<{
      capability: "trade" | "lp" | "lending" | "borrowing" | "yield" | "staking";
      protocol?: "jupiter" | "raydium" | "kamino" | "marinade";
      snapshot: {
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
    }>
  ) {}

  async nextIntents(_context: AgentContext): Promise<AgentIntent[]> {
    return this.requests.map((request) => ({
      type: "defi-capability" as const,
      capability: request.capability,
      protocol: request.protocol,
      snapshot: request.snapshot
    }));
  }
}
