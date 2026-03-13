import { type TransactionConfirmationStrategy, VersionedTransaction } from "@solana/web3.js";

import { TransactionService } from "../../core/transactions/TransactionService";
import { PolicyEngine } from "../engine/PolicyEngine";
import type { ApprovalCallback, TxInspectionContext, TxInspectionResult } from "../types/policy";
import { AuditLogManager } from "../../compression/AuditLogManager";
import { PolicyCircuit, PolicyProof, PolicyViolation } from "../../zk/PolicyCircuit";
import { ProofAnchor } from "../../zk/ProofAnchor";
import { defaultPRKTConfig } from "../../config/PRKTConfig";
import { isNeonBroadcastEnabled } from "../../config/env";
import { Keypair, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { ethers } from "ethers";
import { NeonWalletBridge } from "../../evm/NeonWalletBridge";
import { WalletManager } from "../../core/wallet/WalletManager";

export type SandboxExecutionResult = {
  inspection: TxInspectionResult;
  signature: string | null;
  simulationLogs: string[] | null;
  zkProof?: PolicyProof;
};

export class SandboxExecutor {
  private readonly auditLogManager: AuditLogManager;
  private readonly proofAnchor: ProofAnchor;
  private readonly useCompression: boolean;
  private readonly useZkProofs: boolean;

  constructor(
    private readonly policyEngine: PolicyEngine,
    private readonly transactionService: TransactionService,
    private readonly approvalMode: "sandbox" | "live",
    private readonly approvalCallback?: ApprovalCallback
  ) {
    this.useCompression = defaultPRKTConfig.zkCompression.enabled;
    this.useZkProofs = defaultPRKTConfig.zkPolicyProofs.enabled;
    this.auditLogManager = new AuditLogManager(defaultPRKTConfig.zkCompression.rpcEndpoint);
    this.proofAnchor = new ProofAnchor(defaultPRKTConfig.zkCompression.rpcEndpoint);
  }

  async executePreparedTransaction(input: {
    confirmationStrategy?: TransactionConfirmationStrategy | string;
    solanaKeypair?: Keypair;
    transaction: VersionedTransaction;
    inspectionContext?: TxInspectionContext;
  }): Promise<SandboxExecutionResult> {
    const inspection = this.policyEngine.inspect(input.transaction, input.inspectionContext);
    const agentId = this.policyEngine.getAuditTrail().at(-1)?.agentId ?? "unknown-agent";
    const auditSigner = this.resolveProofSigner(input.solanaKeypair);

    if (!inspection.allowed) {
      if (this.useCompression) {
        await this.auditLogManager.appendAuditEntry({
          agentId,
          timestamp: Date.now(),
          intentType: "UNKNOWN",
          approved: false,
          rejectionReason: inspection.reasons.join("; "),
          simulationResult: "skipped"
        }, auditSigner).catch(() => { }); // catch to not block execution
      }
      return {
        inspection,
        signature: null,
        simulationLogs: null
      };
    }

    const simulation = await this.transactionService.simulate(input.transaction);
    if (simulation.err) {
      if (this.useCompression) {
        await this.auditLogManager.appendAuditEntry({
          agentId,
          timestamp: Date.now(),
          intentType: "UNKNOWN",
          approved: false,
          rejectionReason: "simulation failed",
          simulationResult: "failed"
        }, auditSigner).catch(() => { });
      }
      return {
        inspection: {
          ...inspection,
          allowed: false,
          reasons: [...inspection.reasons, "simulation failed"]
        },
        signature: null,
        simulationLogs: simulation.logs
      };
    }

    if (this.approvalMode === "live") {
      if (!this.approvalCallback) {
        return {
          inspection: {
            ...inspection,
            allowed: false,
            reasons: [...inspection.reasons, "live approval callback missing"]
          },
          signature: null,
          simulationLogs: simulation.logs
        };
      }

      const approved = await this.approvalCallback({
        agentId,
        inspection,
        transaction: input.transaction
      });
      if (!approved) {
        return {
          inspection: {
            ...inspection,
            allowed: false,
            reasons: [...inspection.reasons, "manual approval rejected"]
          },
          signature: null,
          simulationLogs: simulation.logs
        };
      }
    }

    let proofSigner: Keypair | undefined;
    let zkProof: PolicyProof | undefined;
    if (this.useZkProofs) {
      proofSigner = this.resolveProofSigner(input.solanaKeypair);
      const state = this.buildProofState(false);

      try {
        const proofResult = await PolicyCircuit.prove(
          input.transaction,
          state,
          "EXECUTE",
          BigInt(inspection.details.totalSolSpendLamports),
          proofSigner
        );
        zkProof = proofResult.proof;
      } catch (error) {
        if (!(error instanceof PolicyViolation)) {
          throw error;
        }
        return {
          inspection: {
            ...inspection,
            allowed: false,
            reasons: [...inspection.reasons, `Policy attestation rejected: ${error.message}`]
          },
          signature: null,
          simulationLogs: simulation.logs
        };
      }
    }

    const send = await this.transactionService.sendAndConfirm({
      confirmationStrategy: input.confirmationStrategy,
      transaction: input.transaction
    });
    this.policyEngine.recordBroadcast(
      send.signature,
      Number(inspection.details.totalSolSpendLamports) / 1_000_000_000
    );

    if (zkProof && send.signature) {
      await this.proofAnchor.anchorProof(zkProof, send.signature, proofSigner);
    }

    if (this.useCompression && send.signature) {
      await this.auditLogManager.appendAuditEntry({
        agentId,
        timestamp: Date.now(),
        intentType: "EXECUTE",
        approved: true,
        simulationResult: "success",
        txSignature: send.signature
      }, auditSigner).catch(() => { });
    }

    return {
      inspection,
      signature: send.signature,
      simulationLogs: simulation.logs,
      zkProof
    };
  }

  async executePreparedEvmTransaction(input: {
    solanaKeypair?: Keypair;
    transaction: ethers.TransactionRequest;
    address: string;
    inspectionContext?: TxInspectionContext;
  }): Promise<{ signature: string | null; allowed: boolean; reason?: string; zkProof?: PolicyProof }> {
    const inspection = this.policyEngine.inspectEvm(input.transaction);
    const agentId = this.policyEngine.getAuditTrail().at(-1)?.agentId ?? "unknown-agent";
    const auditSigner = this.resolveProofSigner(input.solanaKeypair);

    if (!inspection.allowed) {
      if (this.useCompression) {
        await this.auditLogManager.appendAuditEntry({
          agentId,
          timestamp: Date.now(),
          intentType: "EXECUTE_EVM",
          approved: false,
          rejectionReason: inspection.reason ?? inspection.reasons.join("; "),
          simulationResult: "skipped"
        }, auditSigner).catch(() => { });
      }
      return {
        allowed: false,
        reason: inspection.reason ?? inspection.reasons.join("; "),
        signature: null
      };
    }

    const provider = new ethers.JsonRpcProvider(defaultPRKTConfig.evmAdapters.neonRpcEndpoint);
    try {
      await provider.call({
        ...input.transaction,
        from: input.transaction.from ?? input.address
      });
      await provider.estimateGas({
        ...input.transaction,
        from: input.transaction.from ?? input.address
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "eth_call reverted";
      if (this.useCompression) {
        await this.auditLogManager.appendAuditEntry({
          agentId,
          timestamp: Date.now(),
          intentType: "EXECUTE_EVM",
          approved: false,
          rejectionReason: reason,
          simulationResult: "failed"
        }, auditSigner).catch(() => { });
      }
      return { signature: null, allowed: false, reason };
    }

    if (this.approvalMode === "live") {
      if (!this.approvalCallback) {
        return { signature: null, allowed: false, reason: "live approval callback missing" };
      }

      const approved = await this.approvalCallback({
        agentId,
        inspection,
        transaction: input.transaction as any
      });

      if (!approved) {
        return { signature: null, allowed: false, reason: "manual approval rejected" };
      }
    }

    if (!isNeonBroadcastEnabled()) {
      const reason = "NEON_BROADCAST_DISABLED";
      if (this.useCompression) {
        await this.auditLogManager.appendAuditEntry({
          agentId,
          timestamp: Date.now(),
          intentType: "EXECUTE_EVM",
          approved: false,
          rejectionReason: reason,
          simulationResult: "skipped"
        }, auditSigner).catch(() => { });
      }
      return { signature: null, allowed: false, reason };
    }

    let proofSigner: Keypair | undefined;
    let zkProof: PolicyProof | undefined;
    if (this.useZkProofs) {
      proofSigner = this.resolveProofSigner(input.solanaKeypair);
      const state = this.buildProofState(true);

      try {
        const proofResult = await PolicyCircuit.prove(
          {
            address: input.address,
            transaction: this.serializeEvmTransaction(input.transaction)
          },
          state,
          "EXECUTE_EVM",
          BigInt(inspection.details.totalSolSpendLamports),
          proofSigner
        );
        zkProof = proofResult.proof;
      } catch (error) {
        if (!(error instanceof PolicyViolation)) {
          throw error;
        }
        return { signature: null, allowed: false, reason: error.message };
      }
    }

    // Wrap and sign
    const bridge = new NeonWalletBridge(defaultPRKTConfig.evmAdapters.neonRpcEndpoint);
    const signedTransaction = await bridge.signEvmTransaction(
      {
        ...input.transaction,
        from: input.transaction.from ?? input.address
      },
      input.solanaKeypair ?? Keypair.generate()
    );
    const broadcast = await provider.broadcastTransaction(signedTransaction);
    await broadcast.wait();
    const signature = broadcast.hash;

    this.policyEngine.recordBroadcast(
      signature,
      Number(inspection.details.totalSolSpendLamports) / 1_000_000_000
    );

    if (zkProof && signature) {
      await this.proofAnchor.anchorProof(zkProof, signature, proofSigner);
    }

    if (this.useCompression && signature) {
      await this.auditLogManager.appendAuditEntry({
        agentId,
        timestamp: Date.now(),
        intentType: "EXECUTE_EVM",
        approved: true,
        simulationResult: "success",
        txSignature: signature
      }, auditSigner);
    }

    return { signature, allowed: true, zkProof };
  }

  private resolveProofSigner(preferred?: Keypair): Keypair {
    if (preferred) {
      return preferred;
    }

    try {
      return WalletManager.loadOrGenerate().payer;
    } catch {
      return Keypair.generate();
    }
  }

  private serializeEvmTransaction(transaction: ethers.TransactionRequest): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(transaction).map(([key, value]) => {
        if (typeof value === "bigint") {
          return [key, value.toString()];
        }
        return [key, value ?? null];
      })
    );
  }

  private buildProofState(includeEvmAllowlist: boolean) {
    const policyConfig = this.policyEngine.getPolicyConfig();
    const now = Date.now();
    const sessionExpiry = Date.parse(policyConfig.sessionExpiresAtIso8601);
    const sessionTtlMinutes = Number.isNaN(sessionExpiry)
      ? 0
      : Math.max(0, Math.ceil((sessionExpiry - now) / 60_000));

    return {
      agentId: policyConfig.agentId,
      dailySpendLimit: new BN(policyConfig.limits.maxSolPerTxLamports.toString()),
      killSwitchActive: false,
      lastResetTimestamp: now,
      programAllowlist: includeEvmAllowlist
        ? []
        : policyConfig.rules.allowedProgramIds
            .map((programId) => {
              try {
                return new PublicKey(programId);
              } catch {
                return null;
              }
            })
            .filter((programId): programId is PublicKey => programId !== null),
      sessionTTL: sessionTtlMinutes,
      spentToday: new BN(Math.round(this.policyEngine.getSpentToday() * 1_000_000_000))
    };
  }
}
