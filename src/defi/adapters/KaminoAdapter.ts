import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { PROTOCOL_PRESETS } from "../protocols";
import type { DeFiIntent, MarketSnapshot } from "../types";

const USDC_ATOMIC = 1_000_000;
const MIN_BORROW_USDC_ATOMIC = 2 * USDC_ATOMIC;
const MIN_COLLATERAL_SOL_LAMPORTS = Math.round(0.75 * LAMPORTS_PER_SOL);

export class KaminoAdapter {
  readonly protocol = "kamino" as const;

  buildDepositIntent(snapshot: MarketSnapshot): DeFiIntent | null {
    const idleUsdcAtomic = snapshot.idleUsdcAtomic ?? 0;
    if (idleUsdcAtomic < 2 * USDC_ATOMIC) {
      return null;
    }

    return {
      action: "deposit",
      amountLamports: Math.round(0.5 * LAMPORTS_PER_SOL),
      expectedHealthFactor: snapshot.healthFactor ?? 2,
      marketId: PROTOCOL_PRESETS.kamino.defaultMarketId,
      memo: "DEFI_INTENT:KAMINO:deposit:USDC",
      protocol: this.protocol,
      slippageBps: 40
    };
  }

  buildBorrowIntent(snapshot: MarketSnapshot): DeFiIntent | null {
    const borrowDemandUsdcAtomic = snapshot.borrowDemandUsdcAtomic ?? 0;
    const collateralSolLamports = snapshot.collateralSolLamports ?? 0;
    const expectedHealthFactor = snapshot.healthFactor ?? 0;
    if (borrowDemandUsdcAtomic < MIN_BORROW_USDC_ATOMIC) {
      return null;
    }

    if (collateralSolLamports < MIN_COLLATERAL_SOL_LAMPORTS) {
      return null;
    }

    if (expectedHealthFactor < 2) {
      return null;
    }

    return {
      action: "borrow",
      amountLamports: Math.round(0.25 * LAMPORTS_PER_SOL),
      expectedHealthFactor,
      marketId: PROTOCOL_PRESETS.kamino.defaultMarketId,
      memo: `DEFI_INTENT:KAMINO:borrow:USDC:${borrowDemandUsdcAtomic}`,
      protocol: this.protocol,
      slippageBps: 40
    };
  }
}
