import { PublicKey } from "@solana/web3.js";

import { PolicyEngine, SandboxExecutor, type ApprovalCallback, type PolicyConfig } from "../../policy";
import type { AgentIntent } from "../intents/types";
import type { AgentContext, Strategy } from "../types/AgentContext";
import { AgentRegistry } from "../registry/AgentRegistry";
import type { PolicyConfigPatch } from "../../defi/universal";
import { PolicyAccountManager } from "../../compression/PolicyAccountManager";
import { AuditLogManager } from "../../compression/AuditLogManager";
import { SessionAnchor } from "../../anchoring/SessionAnchor";
import { defaultPRKTConfig } from "../../config/PRKTConfig";

export type IntentExecutionOutcome = {
  intent: AgentIntent;
  allowed: boolean;
  signature: string | null;
  reasons: string[];
};

export type AgentRunResult = {
  agentId: string;
  strategy: string;
  outcomes: IntentExecutionOutcome[];
};

type RuntimeHandle = {
  approvalCallback?: ApprovalCallback;
  approvalMode: "sandbox" | "live";
  context: AgentContext;
  strategy: Strategy;
  policyEngine: PolicyEngine;
  sandboxExecutor: SandboxExecutor;
  sessionId?: string;
};

export class AgentRunner {
  private readonly registry = new AgentRegistry();
  private readonly runtimes = new Map<string, RuntimeHandle>();
  private readonly policyAccountManager: PolicyAccountManager;
  private readonly auditLogManager: AuditLogManager;
  private readonly sessionAnchor: SessionAnchor;

  constructor() {
    this.policyAccountManager = new PolicyAccountManager(defaultPRKTConfig.zkCompression.rpcEndpoint);
    this.auditLogManager = new AuditLogManager(defaultPRKTConfig.zkCompression.rpcEndpoint);
    this.sessionAnchor = new SessionAnchor(defaultPRKTConfig.zkCompression.rpcEndpoint);
  }

  async registerCompressedAgent(input: {
    context: AgentContext;
    strategy: Strategy;
    approvalMode?: "sandbox" | "live";
    approvalCallback?: ApprovalCallback;
  }): Promise<void> {
    if (!defaultPRKTConfig.zkCompression.enabled) {
      return this.registerAgent(input);
    }

    // Wire policy READ through compressed account
    const compressed = await this.policyAccountManager.fetchCompressedPolicyAccount(input.context.id);

    const policyConfig: PolicyConfig = {
      agentId: compressed.agentId,
      approvalMode: input.approvalMode ?? "sandbox",
      limits: {
        maxTransactionsPerDay: 100, // Derived or default
        maxTransactionsPerSession: 50,
        maxSolPerTxLamports: Number(compressed.dailySpendLimit.toString()), // Approximated
        maxSplPerTxRawAmount: BigInt(compressed.dailySpendLimit.toString())
      },
      rules: {
        allowedMintAddresses: [],
        allowedProgramIds: compressed.programAllowlist.map((pk: PublicKey) => pk.toBase58()),
        allowOpaqueProgramIds: [],
        denyUnknownInstructionsByDefault: true,
        rejectSuspiciousBalanceDeltas: true,
        requireSimulationSuccess: true
      },
      sessionExpiresAtIso8601: new Date(Date.now() + compressed.sessionTTL * 60000).toISOString()
    };

    this.registerAgent({
      ...input,
      policyConfig
    });
  }

  async registerAgent(input: {
    context: AgentContext;
    strategy: Strategy;
    policyConfig?: PolicyConfig;
    approvalMode?: "sandbox" | "live";
    approvalCallback?: ApprovalCallback;
  }): Promise<void> {
    const policyConfig = input.policyConfig ?? input.context.policyConfig;
    const policyEngine = new PolicyEngine({
      ...policyConfig,
      approvalMode: input.approvalMode ?? policyConfig.approvalMode
    });
    const sandboxExecutor = new SandboxExecutor(
      policyEngine,
      input.context.transactionService,
      input.approvalMode ?? policyConfig.approvalMode,
      input.approvalCallback
    );

    let sessionId: string | undefined;
    if (defaultPRKTConfig.dataAnchoring.enabled) {
      sessionId = (await this.sessionAnchor.startSession(input.context.id)).sessionId;
    }

    this.registry.register({
      context: {
        ...input.context,
        policyConfig
      },
      strategy: input.strategy
    });

    this.runtimes.set(input.context.id, {
      context: {
        ...input.context,
        policyConfig
      },
      approvalCallback: input.approvalCallback,
      approvalMode: input.approvalMode ?? policyConfig.approvalMode,
      strategy: input.strategy,
      policyEngine,
      sandboxExecutor,
      sessionId
    });
  }

  async closeAgentSession(agentId: string): Promise<{ commitment: string; ledgerSlot: number } | null> {
    const runtime = this.runtimes.get(agentId);
    if (!runtime || !runtime.sessionId) {
      return null;
    }

    const logs = await this.auditLogManager.fetchAuditLog(agentId);
    const result = await this.sessionAnchor.closeSession(runtime.sessionId, logs);
    runtime.sessionId = undefined; // clear
    return result;
  }

  listAgents(): Array<{ id: string; strategy: string }> {
    return this.registry.list().map((entry) => ({
      id: entry.context.id,
      strategy: entry.strategy.name
    }));
  }

  async runOnceParallel(): Promise<AgentRunResult[]> {
    const agents = this.registry.list();
    return Promise.all(
      agents.map(async (registered) => {
        const runtime = this.runtimes.get(registered.context.id);
        if (!runtime) {
          return {
            agentId: registered.context.id,
            strategy: registered.strategy.name,
            outcomes: []
          };
        }
        const intents = await registered.strategy.nextIntents(registered.context);
        const outcomes = await this.executeIntents(runtime, intents);
        return {
          agentId: registered.context.id,
          strategy: registered.strategy.name,
          outcomes
        };
      })
    );
  }

  async runRounds(rounds: number): Promise<AgentRunResult[]> {
    const aggregate = new Map<string, AgentRunResult>();
    for (let index = 0; index < rounds; index += 1) {
      const results = await this.runOnceParallel();
      for (const result of results) {
        const existing = aggregate.get(result.agentId);
        if (!existing) {
          aggregate.set(result.agentId, {
            ...result,
            outcomes: [...result.outcomes]
          });
          continue;
        }
        existing.outcomes.push(...result.outcomes);
      }
    }
    return Array.from(aggregate.values());
  }

  private async executeIntents(
    runtime: RuntimeHandle,
    intents: AgentIntent[]
  ): Promise<IntentExecutionOutcome[]> {
    const outcomes: IntentExecutionOutcome[] = [];
    for (const intent of intents) {
      try {
        if (intent.type === "defi-capability") {
          if (!runtime.context.universalDeFiExecutor) {
            throw new Error("universal DeFi executor is not configured for this agent");
          }

          const result = await runtime.context.universalDeFiExecutor.execute({
            capability: intent.capability,
            protocol: intent.protocol,
            snapshot: intent.snapshot
          }, {
            liveExecutor: {
              executePreparedTransaction: (
                input: {
                  confirmationStrategy?: Parameters<SandboxExecutor["executePreparedTransaction"]>[0]["confirmationStrategy"];
                  inspectionContext?: Parameters<SandboxExecutor["executePreparedTransaction"]>[0]["inspectionContext"];
                  policyConfigPatch?: PolicyConfigPatch;
                  transaction: Parameters<SandboxExecutor["executePreparedTransaction"]>[0]["transaction"];
                }
              ) =>
                this.executePreparedTransaction(runtime, input)
            }
          });

          outcomes.push({
            intent,
            allowed: result.result !== null,
            signature: result.result?.signature ?? null,
            reasons: result.result
              ? result.result.mock
                ? ["executed via memo/mock fallback"]
                : []
              : [`no execution for ${result.capability}/${result.protocol}`]
          });
          continue;
        }

        const built = await this.buildIntentTransaction(runtime.context, intent);
        const execution = await runtime.sandboxExecutor.executePreparedTransaction({
          confirmationStrategy: built.confirmationStrategy,
          transaction: built.transaction
        });
        const allowed = execution.signature !== null;
        outcomes.push({
          intent,
          allowed,
          signature: execution.signature,
          reasons: execution.inspection.reasons
        });
      } catch (error: unknown) {
        outcomes.push({
          intent,
          allowed: false,
          signature: null,
          reasons: [error instanceof Error ? error.message : "unknown intent failure"]
        });
      }
    }
    return outcomes;
  }

  private async buildIntentTransaction(context: AgentContext, intent: AgentIntent) {
    if (intent.type === "write-memo") {
      return context.transactionService.buildTransaction({
        feePayer: context.walletPublicKey,
        instructions: [context.transactionService.buildMemoInstruction(intent.memo)],
        signer: context.walletManager
      });
    }

    if (intent.type === "transfer-sol") {
      return context.transactionService.buildTransaction({
        feePayer: context.walletPublicKey,
        instructions: [
          context.transactionService.buildSolTransferInstruction({
            from: context.walletPublicKey,
            to: new PublicKey(intent.to),
            lamports: intent.lamports
          })
        ],
        signer: context.walletManager
      });
    }

    if (intent.type === "create-ata") {
      const ata = await context.tokenService.ensureAtaInstruction({
        mint: new PublicKey(intent.mint),
        owner: new PublicKey(intent.owner),
        payer: context.walletPublicKey
      });
      if (!ata.createInstruction) {
        return context.transactionService.buildTransaction({
          feePayer: context.walletPublicKey,
          instructions: [context.transactionService.buildMemoInstruction(`ata-exists:${ata.address.toBase58()}`)],
          signer: context.walletManager
        });
      }

      return context.transactionService.buildTransaction({
        feePayer: context.walletPublicKey,
        instructions: [ata.createInstruction],
        signer: context.walletManager
      });
    }

    if (intent.type === "transfer-spl") {
      const mint = new PublicKey(intent.mint);
      const mintDecimals = await context.tokenService.getMintDecimals(mint);
      const sourceAta = context.tokenService.findAssociatedTokenAddress(context.walletPublicKey, mint);
      const destinationAta = context.tokenService.findAssociatedTokenAddress(new PublicKey(intent.toOwner), mint);
      const createDestination = await context.tokenService.ensureAtaInstruction({
        mint,
        owner: new PublicKey(intent.toOwner),
        payer: context.walletPublicKey
      });

      const instructions = [
        ...(createDestination.createInstruction ? [createDestination.createInstruction] : []),
        context.transactionService.buildSplTransferCheckedInstruction({
          sourceAta,
          mint,
          destinationAta,
          owner: context.walletPublicKey,
          amount: intent.amountRaw,
          decimals: mintDecimals
        })
      ];

      return context.transactionService.buildTransaction({
        feePayer: context.walletPublicKey,
        instructions,
        signer: context.walletManager
      });
    }

    if (intent.type === "mint-token") {
      const mint = new PublicKey(intent.mint);
      const destinationOwner = new PublicKey(intent.toOwner);
      const destination = await context.tokenService.ensureAtaInstruction({
        mint,
        owner: destinationOwner,
        payer: context.walletPublicKey
      });
      const instructions = [
        ...(destination.createInstruction ? [destination.createInstruction] : []),
        context.tokenService.buildMintToInstruction({
          mint,
          destinationAta: destination.address,
          authority: context.walletPublicKey,
          amount: intent.amountRaw
        })
      ];
      return context.transactionService.buildTransaction({
        feePayer: context.walletPublicKey,
        instructions,
        signer: context.walletManager
      });
    }

    throw new Error(`Unsupported intent type: ${(intent as { type: string }).type}`);
  }

  private executePreparedTransaction(
    runtime: RuntimeHandle,
    input: {
      confirmationStrategy?: Parameters<SandboxExecutor["executePreparedTransaction"]>[0]["confirmationStrategy"];
      inspectionContext?: Parameters<SandboxExecutor["executePreparedTransaction"]>[0]["inspectionContext"];
      policyConfigPatch?: PolicyConfigPatch;
      transaction: Parameters<SandboxExecutor["executePreparedTransaction"]>[0]["transaction"];
    }
  ) {
    const sandboxExecutor = input.policyConfigPatch
      ? this.createSandboxExecutor(runtime, input.policyConfigPatch)
      : runtime.sandboxExecutor;

    return sandboxExecutor.executePreparedTransaction({
      confirmationStrategy: input.confirmationStrategy,
      inspectionContext: input.inspectionContext,
      transaction: input.transaction
    });
  }

  private createSandboxExecutor(runtime: RuntimeHandle, patch: PolicyConfigPatch): SandboxExecutor {
    const merged = this.mergePolicyConfig(runtime.context.policyConfig, patch);
    const policyEngine = new PolicyEngine({
      ...merged,
      approvalMode: runtime.approvalMode
    });
    return new SandboxExecutor(
      policyEngine,
      runtime.context.transactionService,
      runtime.approvalMode,
      runtime.approvalCallback
    );
  }

  private mergePolicyConfig(base: PolicyConfig, patch: PolicyConfigPatch): PolicyConfig {
    return {
      ...base,
      limits: {
        ...base.limits,
        ...patch.limits
      },
      rules: {
        ...base.rules,
        ...patch.rules,
        allowedMintAddresses: this.mergeUnique(
          base.rules.allowedMintAddresses,
          patch.rules?.allowedMintAddresses
        ),
        allowedProgramIds: this.mergeUnique(
          base.rules.allowedProgramIds,
          patch.rules?.allowedProgramIds
        ),
        allowOpaqueProgramIds: this.mergeUnique(
          base.rules.allowOpaqueProgramIds ?? [],
          patch.rules?.allowOpaqueProgramIds
        ),
        allowedCloseAccountDestinations: this.mergeUnique(
          base.rules.allowedCloseAccountDestinations ?? [],
          patch.rules?.allowedCloseAccountDestinations
        ),
        allowedTransferDestinations: this.mergeUnique(
          base.rules.allowedTransferDestinations ?? [],
          patch.rules?.allowedTransferDestinations
        )
      },
      sessionExpiresAtIso8601: patch.sessionExpiresAtIso8601 ?? base.sessionExpiresAtIso8601
    };
  }

  private mergeUnique(base: string[], extra?: string[]): string[] {
    return Array.from(new Set([...base, ...(extra ?? [])]));
  }
}
