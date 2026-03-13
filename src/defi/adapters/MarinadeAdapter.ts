import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { PROTOCOL_PRESETS } from "../protocols";
import type { DeFiIntent, MarketSnapshot } from "../types";

export class MarinadeAdapter {
  readonly protocol = "marinade" as const;

  buildStakeIntent(snapshot: MarketSnapshot): DeFiIntent | null {
    const idleSolLamports = snapshot.idleSolLamports ?? 0;
    const reserveLamports = Math.round(0.2 * LAMPORTS_PER_SOL);
    const amountLamports = Math.round(0.15 * LAMPORTS_PER_SOL);

    if (idleSolLamports <= reserveLamports + amountLamports) {
      return null;
    }

    return {
      action: "stake",
      amountLamports,
      marketId: PROTOCOL_PRESETS.marinade.defaultMarketId,
      memo: `DEFI_INTENT:MARINADE:stake:${amountLamports}`,
      protocol: this.protocol,
      slippageBps: 25
    };
  }
}
