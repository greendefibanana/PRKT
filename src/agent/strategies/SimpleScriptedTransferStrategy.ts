import type { AgentIntent } from "../intents/types";
import type { AgentContext, Strategy } from "../types/AgentContext";

export class SimpleScriptedTransferStrategy implements Strategy {
  readonly name = "simple-scripted-transfer";

  constructor(
    private readonly plan: {
      to: string;
      lamports: number;
      memo?: string;
    }
  ) {}

  async nextIntents(_context: AgentContext): Promise<AgentIntent[]> {
    const intents: AgentIntent[] = [
      {
        type: "transfer-sol",
        to: this.plan.to,
        lamports: this.plan.lamports
      }
    ];

    if (this.plan.memo) {
      intents.push({
        type: "write-memo",
        memo: this.plan.memo
      });
    }

    return intents;
  }
}
