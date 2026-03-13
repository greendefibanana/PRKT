import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { PROTOCOL_PRESETS } from "../protocols";
import type { DeFiIntent, MarketSnapshot } from "../types";

export class JupiterAdapter {
  readonly protocol = "jupiter" as const;

  buildTradeIntent(snapshot: MarketSnapshot): DeFiIntent | null {
    const solPriceUsd = snapshot.solPriceUsd ?? 0;
    const buyThresholdUsd = snapshot.buyThresholdUsd ?? 0;
    if (solPriceUsd <= 0 || buyThresholdUsd <= 0 || solPriceUsd > buyThresholdUsd) {
      return null;
    }

    const amountLamports = Math.round(0.01 * LAMPORTS_PER_SOL);
    return {
      action: "trade",
      amountLamports,
      marketId: PROTOCOL_PRESETS.jupiter.defaultMarketId,
      memo: `DEFI_INTENT:JUPITER:trade:${amountLamports}`,
      protocol: this.protocol,
      slippageBps: 50
    };
  }
}
