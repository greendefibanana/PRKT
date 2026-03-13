import { PublicKey } from "@solana/web3.js";

import type { AgentIntent } from "../intents/types";
import type { AgentContext, Strategy } from "../types/AgentContext";

export class TokenRebalancerStrategy implements Strategy {
  readonly name = "token-rebalancer";

  constructor(
    private readonly config: {
      mint: string;
      targetOwner: string;
      minBalanceUi: number;
      topUpRawAmount: bigint;
    }
  ) {}

  async nextIntents(context: AgentContext): Promise<AgentIntent[]> {
    const mint = new PublicKey(this.config.mint);
    const currentBalance = await context.balanceService.getSplTokenBalance({
      owner: context.walletPublicKey,
      mint
    });
    if (currentBalance >= this.config.minBalanceUi) {
      return [];
    }

    return [
      {
        type: "create-ata",
        mint: this.config.mint,
        owner: this.config.targetOwner
      },
      {
        type: "transfer-spl",
        mint: this.config.mint,
        toOwner: this.config.targetOwner,
        amountRaw: this.config.topUpRawAmount
      }
    ];
  }
}
