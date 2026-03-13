import type { AgentContext, Strategy } from "../types/AgentContext";

export type RegisteredAgent = {
  context: AgentContext;
  strategy: Strategy;
};

export class AgentRegistry {
  private readonly agents = new Map<string, RegisteredAgent>();

  register(agent: RegisteredAgent): void {
    this.agents.set(agent.context.id, agent);
  }

  get(agentId: string): RegisteredAgent | undefined {
    return this.agents.get(agentId);
  }

  list(): RegisteredAgent[] {
    return Array.from(this.agents.values());
  }
}
