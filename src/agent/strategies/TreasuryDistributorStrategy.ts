import type { AgentIntent } from "../intents/types";
import type { AgentContext, Strategy } from "../types/AgentContext";

export class TreasuryDistributorStrategy implements Strategy {
  readonly name = "treasury-distributor";

  constructor(
    private readonly config: {
      mint: string;
      recipients: string[];
      amountRawPerRecipient: bigint;
    }
  ) {}

  async nextIntents(_context: AgentContext): Promise<AgentIntent[]> {
    return this.config.recipients.flatMap((recipient) => {
      const intents: AgentIntent[] = [
        {
          type: "create-ata",
          mint: this.config.mint,
          owner: recipient
        },
        {
          type: "transfer-spl",
          mint: this.config.mint,
          toOwner: recipient,
          amountRaw: this.config.amountRawPerRecipient
        }
      ];
      return intents;
    });
  }
}
