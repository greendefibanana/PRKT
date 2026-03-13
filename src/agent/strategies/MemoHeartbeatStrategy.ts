import type { AgentIntent } from "../intents/types";
import type { AgentContext, Strategy } from "../types/AgentContext";

export class MemoHeartbeatStrategy implements Strategy {
  readonly name = "memo-heartbeat";

  async nextIntents(context: AgentContext): Promise<AgentIntent[]> {
    return [
      {
        type: "write-memo",
        memo: `heartbeat:${context.id}:${new Date().toISOString()}`
      }
    ];
  }
}
