import {
  AuthorityType,
  decodeApproveCheckedInstruction,
  decodeApproveInstruction,
  decodeCloseAccountInstruction,
  decodeRevokeInstruction,
  decodeSetAuthorityInstruction,
  decodeTransferCheckedInstruction,
  decodeTransferInstruction
} from "@solana/spl-token";
import {
  PublicKey,
  SystemInstruction,
  SystemProgram,
  TransactionMessage,
  type TransactionInstruction,
  type VersionedTransaction
} from "@solana/web3.js";

import type {
  PolicyConfig,
  SecurityAuditEntry,
  TxInspectionContext,
  TxInspectionResult
} from "../types/policy";
import { ethers } from "ethers";
import { getEmergencyLockStatus } from "../emergencyLock";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MEMO_PROGRAM_ID,
  TOKEN_PROGRAM_ID
} from "../../solana/programs";

export class PolicyEngine {
  private readonly sessionStart = Date.now();
  private txCountSession = 0;
  private readonly perDayCounts = new Map<string, number>();
  private readonly auditLog: SecurityAuditEntry[] = [];
  private lastResetTimestamp = Date.now();
  private spentTodaySol = 0;

  constructor(private readonly policyConfig: PolicyConfig) { }

  inspect(transaction: VersionedTransaction, context?: TxInspectionContext): TxInspectionResult {
    const reasons: string[] = [];
    const decompiledMessage = TransactionMessage.decompile(transaction.message);
    let totalSolSpendLamports = 0n;
    let totalSplSpendRaw = 0n;
    const programsSeen = new Set<string>();
    const mintsSeen = new Set<string>();
    let hasUncheckedSplSpend = false;

    const now = Date.now();
    this.maybeResetDailySpend(now);
    const emergencyStatus = getEmergencyLockStatus();
    if (emergencyStatus.locked) {
      reasons.push(emergencyStatus.reason ?? "Human-in-the-loop Override engaged.");
    }

    const sessionExpiry = Date.parse(this.policyConfig.sessionExpiresAtIso8601);
    if (Number.isNaN(sessionExpiry) || now > sessionExpiry) {
      reasons.push("session expired");
    }

    const dayKey = new Date(now).toISOString().slice(0, 10);
    const todaysCount = this.perDayCounts.get(dayKey) ?? 0;
    if (this.txCountSession >= this.policyConfig.limits.maxTransactionsPerSession) {
      reasons.push("max transactions per session exceeded");
    }
    if (todaysCount >= this.policyConfig.limits.maxTransactionsPerDay) {
      reasons.push("max transactions per day exceeded");
    }

    for (const instruction of decompiledMessage.instructions) {
      const programId = instruction.programId.toBase58();
      programsSeen.add(programId);

      if (!this.policyConfig.rules.allowedProgramIds.includes(programId)) {
        reasons.push(`program not allowed: ${programId}`);
        if (this.policyConfig.rules.denyUnknownInstructionsByDefault) {
          continue;
        }
      }

      const blockedVectorReason = this.detectBlockedSpendVector(instruction);
      if (blockedVectorReason) {
        reasons.push(blockedVectorReason);
        continue;
      }

      const spend = this.tryDecodeSpend(instruction);
      if (!spend) {
        if (
          this.policyConfig.rules.denyUnknownInstructionsByDefault &&
          !this.policyConfig.rules.allowOpaqueProgramIds?.includes(programId) &&
          !this.isKnownNonSpendInstruction(programId)
        ) {
          reasons.push(`opaque instruction blocked: ${programId}`);
        }
        continue;
      }

      if (spend.kind === "sol") {
        totalSolSpendLamports += spend.amount;
      } else {
        totalSplSpendRaw += spend.amount;
        hasUncheckedSplSpend ||= !spend.mintVerified;
        if (spend.mint) {
          mintsSeen.add(spend.mint.toBase58());
        }
      }

      if (
        this.policyConfig.rules.allowedTransferDestinations &&
        this.policyConfig.rules.allowedTransferDestinations.length > 0
      ) {
        const destination = spend.destination.toBase58();
        if (!this.policyConfig.rules.allowedTransferDestinations.includes(destination)) {
          reasons.push(`destination not allowlisted: ${destination}`);
        }
      }
    }

    if (totalSolSpendLamports > BigInt(this.policyConfig.limits.maxSolPerTxLamports)) {
      reasons.push("max SOL per transaction exceeded");
    }
    if (
      this.getSpentToday() + this.lamportsToSol(totalSolSpendLamports) >
      this.lamportsToSol(BigInt(this.policyConfig.limits.maxSolPerTxLamports))
    ) {
      reasons.push("DAILY_LIMIT_EXCEEDED");
    }
    if (totalSplSpendRaw > this.policyConfig.limits.maxSplPerTxRawAmount) {
      reasons.push("max SPL per transaction exceeded");
    }

    if (this.policyConfig.rules.allowedMintAddresses.length > 0) {
      if (hasUncheckedSplSpend) {
        reasons.push("unchecked SPL transfer cannot be validated against mint allowlist");
      }

      for (const seenMint of mintsSeen) {
        if (!this.policyConfig.rules.allowedMintAddresses.includes(seenMint)) {
          reasons.push(`mint not allowed: ${seenMint}`);
        }
      }
    }

    if (
      this.policyConfig.rules.rejectSuspiciousBalanceDeltas &&
      context?.expectedBalanceDeltas &&
      context.expectedBalanceDeltas.some((delta) => delta.maxNegativeDeltaRaw < 0n)
    ) {
      reasons.push("invalid expected balance delta");
    }

    const allowed = reasons.length === 0;
    const result: TxInspectionResult = {
      allowed,
      reason: reasons[0],
      reasons,
      details: {
        totalSolSpendLamports,
        totalSplSpendRaw,
        programsSeen: Array.from(programsSeen),
        mintsSeen: Array.from(mintsSeen)
      }
    };

    this.auditLog.push({
      agentId: this.policyConfig.agentId,
      timestampIso8601: new Date().toISOString(),
      decision: allowed ? "allow" : "deny",
      reason: allowed ? "policy checks passed" : reasons.join("; ")
    });

    return result;
  }

  inspectEvm(transaction: ethers.TransactionRequest): TxInspectionResult {
    const reasons: string[] = [];
    const now = Date.now();
    this.maybeResetDailySpend(now);
    const emergencyStatus = getEmergencyLockStatus();

    if (emergencyStatus.locked) {
      reasons.push(emergencyStatus.reason ?? "Human-in-the-loop Override engaged.");
    }

    const sessionExpiry = Date.parse(this.policyConfig.sessionExpiresAtIso8601);
    if (Number.isNaN(sessionExpiry) || now > sessionExpiry) {
      reasons.push("session expired");
    }

    const dayKey = new Date(now).toISOString().slice(0, 10);
    const todaysCount = this.perDayCounts.get(dayKey) ?? 0;
    if (this.txCountSession >= this.policyConfig.limits.maxTransactionsPerSession) {
      reasons.push("max transactions per session exceeded");
    }
    if (todaysCount >= this.policyConfig.limits.maxTransactionsPerDay) {
      reasons.push("max transactions per day exceeded");
    }

    // EVM contract address allowlist (analogous to program allowlist)
    const toAddress = transaction.to?.toString().toLowerCase();
    const allowedProgramsLower = this.policyConfig.rules.allowedProgramIds.map(id => id.toLowerCase());
    if (toAddress && !allowedProgramsLower.includes(toAddress)) {
      reasons.push(`EVM contract not allowed: ${toAddress}`);
      if (!this.policyConfig.rules.allowOpaqueProgramIds?.map(id => id.toLowerCase()).includes(toAddress) && !this.policyConfig.rules.denyUnknownInstructionsByDefault) {
        // allow
      }
    }

    // Aggregate spend limit applies to EVM too (approximate 1 ETH = X SOL if needed, or raw values for test)
    if (transaction.value && BigInt(transaction.value.toString()) > BigInt(this.policyConfig.limits.maxSolPerTxLamports)) {
      reasons.push("max spend per transaction exceeded");
    }
    if (
      this.getSpentToday() + this.lamportsToSol(BigInt(transaction.value?.toString() || "0")) >
      this.lamportsToSol(BigInt(this.policyConfig.limits.maxSolPerTxLamports))
    ) {
      reasons.push("DAILY_LIMIT_EXCEEDED");
    }

    const allowed = reasons.length === 0;
    const result: TxInspectionResult = {
      allowed,
      reason: reasons[0],
      reasons,
      details: {
        totalSolSpendLamports: BigInt(transaction.value?.toString() || "0"),
        totalSplSpendRaw: 0n,
        programsSeen: toAddress ? [toAddress] : [],
        mintsSeen: []
      }
    };

    this.auditLog.push({
      agentId: this.policyConfig.agentId,
      timestampIso8601: new Date().toISOString(),
      decision: allowed ? "allow" : "deny",
      reason: allowed ? "policy checks passed" : reasons.join("; ")
    });

    return result;
  }

  recordBroadcast(signature: string, amountSol = 0): void {
    this.maybeResetDailySpend();
    this.txCountSession += 1;
    const dayKey = new Date().toISOString().slice(0, 10);
    this.perDayCounts.set(dayKey, (this.perDayCounts.get(dayKey) ?? 0) + 1);
    this.recordSpend(amountSol);
    this.auditLog.push({
      agentId: this.policyConfig.agentId,
      timestampIso8601: new Date().toISOString(),
      decision: "allow",
      reason: "broadcasted",
      txSignature: signature
    });
  }

  getAuditTrail(): SecurityAuditEntry[] {
    return [...this.auditLog];
  }

  getSessionAgeMs(): number {
    return Date.now() - this.sessionStart;
  }

  getPolicyConfig(): PolicyConfig {
    return {
      ...this.policyConfig,
      limits: {
        ...this.policyConfig.limits
      },
      rules: {
        ...this.policyConfig.rules,
        allowOpaqueProgramIds: [...(this.policyConfig.rules.allowOpaqueProgramIds ?? [])],
        allowedCloseAccountDestinations: [...(this.policyConfig.rules.allowedCloseAccountDestinations ?? [])],
        allowedMintAddresses: [...this.policyConfig.rules.allowedMintAddresses],
        allowedProgramIds: [...this.policyConfig.rules.allowedProgramIds],
        allowedTransferDestinations: [...(this.policyConfig.rules.allowedTransferDestinations ?? [])]
      }
    };
  }

  getSpentToday(): number {
    this.maybeResetDailySpend();
    return this.spentTodaySol;
  }

  recordSpend(amountSol: number): void {
    this.maybeResetDailySpend();
    this.spentTodaySol += amountSol;
  }

  resetDailySpend(): void {
    this.spentTodaySol = 0;
    this.lastResetTimestamp = Date.now();
  }

  private tryDecodeSpend(instruction: TransactionInstruction):
    | {
      kind: "sol";
      amount: bigint;
      destination: PublicKey;
    }
    | {
      kind: "spl";
      amount: bigint;
      destination: PublicKey;
      mint: PublicKey | null;
      mintVerified: boolean;
    }
    | null {
    if (instruction.programId.equals(SystemProgram.programId)) {
      try {
        const transfer = SystemInstruction.decodeTransfer(instruction);
        return {
          kind: "sol",
          amount: transfer.lamports,
          destination: transfer.toPubkey
        };
      } catch {
        return null;
      }
    }

    try {
      const transfer = decodeTransferInstruction(instruction);
      return {
        kind: "spl",
        amount: BigInt(transfer.data.amount.toString()),
        destination: transfer.keys.destination.pubkey,
        mint: null,
        mintVerified: false
      };
    } catch {
      // ignore
    }

    try {
      const transfer = decodeTransferCheckedInstruction(instruction);
      return {
        kind: "spl",
        amount: BigInt(transfer.data.amount.toString()),
        destination: transfer.keys.destination.pubkey,
        mint: transfer.keys.mint.pubkey,
        mintVerified: true
      };
    } catch {
      // ignore
    }

    return null;
  }

  private detectBlockedSpendVector(instruction: TransactionInstruction): string | null {
    try {
      const approve = decodeApproveInstruction(instruction);
      return `delegate approval blocked: ${approve.keys.delegate.pubkey.toBase58()}`;
    } catch {
      // ignore
    }

    try {
      const approveChecked = decodeApproveCheckedInstruction(instruction);
      return `delegate approval blocked: ${approveChecked.keys.delegate.pubkey.toBase58()}`;
    } catch {
      // ignore
    }

    try {
      const revoke = decodeRevokeInstruction(instruction);
      return `delegate revoke requires explicit approval: ${revoke.keys.account.pubkey.toBase58()}`;
    } catch {
      // ignore
    }

    try {
      const closeAccount = decodeCloseAccountInstruction(instruction);
      const destination = closeAccount.keys.destination.pubkey.toBase58();
      if (
        this.policyConfig.rules.allowedCloseAccountDestinations?.includes(destination) ?? false
      ) {
        return null;
      }

      return `close-account drain blocked: ${closeAccount.keys.destination.pubkey.toBase58()}`;
    } catch {
      // ignore
    }

    try {
      const setAuthority = decodeSetAuthorityInstruction(instruction);
      if (
        setAuthority.data.authorityType === AuthorityType.AccountOwner ||
        setAuthority.data.authorityType === AuthorityType.CloseAccount ||
        setAuthority.data.authorityType === AuthorityType.MintTokens
      ) {
        return `authority change blocked: ${AuthorityType[setAuthority.data.authorityType]}`;
      }
    } catch {
      // ignore
    }

    return null;
  }

  private isKnownNonSpendInstruction(programId: string): boolean {
    return (
      programId === SystemProgram.programId.toBase58() ||
      programId === TOKEN_PROGRAM_ID.toBase58() ||
      programId === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58() ||
      programId === MEMO_PROGRAM_ID.toBase58() ||
      (this.policyConfig.rules.allowOpaqueProgramIds?.includes(programId) ?? false)
    );
  }

  private maybeResetDailySpend(now = Date.now()): void {
    if (this.getUtcDayKey(this.lastResetTimestamp) === this.getUtcDayKey(now)) {
      return;
    }

    this.spentTodaySol = 0;
    this.lastResetTimestamp = now;
  }

  private getUtcDayKey(timestamp: number): string {
    return new Date(timestamp).toISOString().slice(0, 10);
  }

  private lamportsToSol(amountLamports: bigint): number {
    return Number(amountLamports) / 1_000_000_000;
  }
}
