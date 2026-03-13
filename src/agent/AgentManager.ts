import { PolicyGuard } from "../policy/PolicyGuard";
import type { PolicyConstraints } from "../types/policy";
import { WalletManager } from "../wallet/WalletManager";
import { createDefaultAgentPolicy } from "./policyFactory";
import { MockPriceFeed } from "./MockPriceFeed";
import { KoraSigner } from "../kora/KoraSigner";
import { simulateMarketAction, type TradeSimulationResult } from "./AgentRuntime";
import { SwapExecutor } from "../dex/SwapExecutor";

export type ManagedAgent = {
  id: string;
  policy: PolicyConstraints;
  policyGuard: PolicyGuard;
  walletManager: WalletManager;
};

export type AgentSafetyControls = {
  cooldownMs: number;
  maxActionsPerWindow: number;
  maxConsecutiveFailures: number;
  windowMs: number;
};

export type ManagedSimulationEvent =
  | {
      agentId: string;
      iteration: number;
      result: TradeSimulationResult;
      status: "executed";
    }
  | {
      agentId: string;
      iteration: number;
      reason: string;
      status: "blocked" | "failed";
    };

function createDefaultSafetyControls(): AgentSafetyControls {
  return {
    cooldownMs: 30_000,
    maxActionsPerWindow: 5,
    maxConsecutiveFailures: 3,
    windowMs: 60_000
  };
}

class AgentExecutionController {
  private attemptsInWindow: number[] = [];
  private consecutiveFailures = 0;
  private openUntilTimestamp = 0;

  constructor(private readonly controls: AgentSafetyControls) {}

  beforeExecution(now: number): { allowed: true } | { allowed: false; reason: string } {
    this.pruneAttempts(now);

    if (now < this.openUntilTimestamp) {
      return {
        allowed: false,
        reason: `circuit breaker open until ${new Date(this.openUntilTimestamp).toISOString()}`
      };
    }

    if (this.attemptsInWindow.length >= this.controls.maxActionsPerWindow) {
      return {
        allowed: false,
        reason: `rate limit exceeded: max ${this.controls.maxActionsPerWindow} actions per ${this.controls.windowMs}ms`
      };
    }

    this.attemptsInWindow.push(now);
    return { allowed: true };
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  recordFailure(now: number): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.controls.maxConsecutiveFailures) {
      this.openUntilTimestamp = now + this.controls.cooldownMs;
      this.consecutiveFailures = 0;
    }
  }

  private pruneAttempts(now: number): void {
    const windowStart = now - this.controls.windowMs;
    this.attemptsInWindow = this.attemptsInWindow.filter((timestamp) => timestamp >= windowStart);
  }
}

export class AgentManager {
  static spawnAgents(count: number): ManagedAgent[] {
    return Array.from({ length: count }, (_, index) => {
      const walletManager = WalletManager.generate();
      const policy = createDefaultAgentPolicy({
        maxSpend: {
          lamports: 500_000 + index * 250_000
        }
      });

      return {
        id: `agent-${index + 1}`,
        policy,
        policyGuard: new PolicyGuard(policy),
        walletManager
      };
    });
  }

  static async runConcurrentTradeSimulation(input: {
    amountSol: number;
    koraSigner: KoraSigner;
    liveSwapConfig?: {
      enabled: boolean;
      outputMint: string;
      swapExecutor: SwapExecutor | null;
    };
    logger?: (message: string) => void;
    priceFeed: MockPriceFeed;
  }): Promise<Array<{ agentId: string; result: TradeSimulationResult }>> {
    const agents = AgentManager.spawnAgents(3);
    const logger = input.logger ?? (() => undefined);

    const results = await Promise.all(
      agents.map(async (agent) => {
        logger(`Scheduling ${agent.id} (${agent.walletManager.publicKey.toBase58()})`);
        const result = await simulateMarketAction({
          amountSol: input.amountSol,
          koraSigner: input.koraSigner,
          liveSwapConfig: input.liveSwapConfig,
          logger: (message) => logger(`${agent.id}: ${message}`),
          policyGuard: agent.policyGuard,
          priceFeed: input.priceFeed,
          walletManager: agent.walletManager
        });

        return {
          agentId: agent.id,
          result
        };
      })
    );

    return results;
  }

  static async runManagedTradeSimulation(input: {
    amountSol: number;
    koraSigner: KoraSigner;
    liveSwapConfig?: {
      enabled: boolean;
      outputMint: string;
      swapExecutor: SwapExecutor | null;
    };
    logger?: (message: string) => void;
    priceFeed: MockPriceFeed;
    rounds: number;
    safetyControls?: Partial<AgentSafetyControls>;
    simulateAction?: (agent: ManagedAgent) => Promise<TradeSimulationResult>;
  }): Promise<ManagedSimulationEvent[]> {
    const agents = AgentManager.spawnAgents(3);
    const logger = input.logger ?? (() => undefined);
    const controls = {
      ...createDefaultSafetyControls(),
      ...input.safetyControls
    };

    const controllers = new Map<string, AgentExecutionController>();
    for (const agent of agents) {
      controllers.set(agent.id, new AgentExecutionController(controls));
    }

    const events: ManagedSimulationEvent[] = [];

    for (let iteration = 1; iteration <= input.rounds; iteration += 1) {
      const iterationEvents = await Promise.all(
        agents.map(async (agent) => {
          const controller = controllers.get(agent.id);
          if (!controller) {
            return {
              agentId: agent.id,
              iteration,
              reason: "agent controller missing",
              status: "failed"
            } satisfies ManagedSimulationEvent;
          }

          const now = Date.now();
          const precheck = controller.beforeExecution(now);
          if (!precheck.allowed) {
            const message = `${agent.id}: blocked (${precheck.reason})`;
            logger(message);
            return {
              agentId: agent.id,
              iteration,
              reason: precheck.reason,
              status: "blocked"
            } satisfies ManagedSimulationEvent;
          }

          try {
            const result = input.simulateAction
              ? await input.simulateAction(agent)
              : await simulateMarketAction({
                  amountSol: input.amountSol,
                  koraSigner: input.koraSigner,
                  liveSwapConfig: input.liveSwapConfig,
                  logger: (message) => logger(`${agent.id}: ${message}`),
                  policyGuard: agent.policyGuard,
                  priceFeed: input.priceFeed,
                  walletManager: agent.walletManager
                });

            controller.recordSuccess();
            return {
              agentId: agent.id,
              iteration,
              result,
              status: "executed"
            } satisfies ManagedSimulationEvent;
          } catch (error: unknown) {
            controller.recordFailure(now);
            const reason = error instanceof Error ? error.message : "unknown execution error";
            logger(`${agent.id}: failed (${reason})`);
            return {
              agentId: agent.id,
              iteration,
              reason,
              status: "failed"
            } satisfies ManagedSimulationEvent;
          }
        })
      );

      events.push(...iterationEvents);
    }

    return events;
  }
}
