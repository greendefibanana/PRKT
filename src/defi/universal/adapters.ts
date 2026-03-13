import { JupiterAdapter } from "../adapters/JupiterAdapter";
import { KaminoAdapter } from "../adapters/KaminoAdapter";
import { MarinadeAdapter } from "../adapters/MarinadeAdapter";
import { RaydiumAdapter } from "../adapters/RaydiumAdapter";
import type { UniversalDeFiAdapter, UniversalDeFiRequest } from "./types";

export class JupiterUniversalAdapter implements UniversalDeFiAdapter {
  readonly protocol = "jupiter" as const;
  readonly capabilities = ["trade"] as const;
  private readonly adapter = new JupiterAdapter();

  buildIntent(request: UniversalDeFiRequest) {
    if (request.capability !== "trade") {
      return null;
    }
    return this.adapter.buildTradeIntent(request.snapshot);
  }
}

export class MarinadeUniversalAdapter implements UniversalDeFiAdapter {
  readonly protocol = "marinade" as const;
  readonly capabilities = ["staking"] as const;
  private readonly adapter = new MarinadeAdapter();

  buildIntent(request: UniversalDeFiRequest) {
    if (request.capability !== "staking") {
      return null;
    }
    return this.adapter.buildStakeIntent(request.snapshot);
  }
}

export class RaydiumUniversalAdapter implements UniversalDeFiAdapter {
  readonly protocol = "raydium" as const;
  readonly capabilities = ["lp", "yield"] as const;
  private readonly adapter = new RaydiumAdapter();

  buildIntent(request: UniversalDeFiRequest) {
    if (request.capability === "lp") {
      return this.adapter.buildAddLiquidityIntent(request.snapshot);
    }

    if (request.capability === "yield") {
      const rewards = request.snapshot.rewardsClaimableAtomic ?? 0;
      if (rewards <= 0) {
        return null;
      }
      const plan = this.adapter.buildAddLiquidityPlan();
      return {
        action: "harvest" as const,
        amountLamports: 0,
        marketId: plan.poolId,
        memo: `DEFI_INTENT:RAYDIUM:harvest:${rewards}`,
        protocol: this.protocol,
        slippageBps: plan.slippageBps
      };
    }

    return null;
  }
}

export class KaminoUniversalAdapter implements UniversalDeFiAdapter {
  readonly protocol = "kamino" as const;
  readonly capabilities = ["lending", "borrowing", "yield"] as const;
  private readonly adapter = new KaminoAdapter();

  buildIntent(request: UniversalDeFiRequest) {
    if (request.capability === "borrowing") {
      return this.adapter.buildBorrowIntent(request.snapshot);
    }

    if (request.capability !== "lending" && request.capability !== "yield") {
      return null;
    }

    return this.adapter.buildDepositIntent(request.snapshot);
  }
}
