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

import { SecurityViolationError } from "./errors";
import { getEmergencyLockStatus } from "./emergencyLock";
import type { PolicyConstraints } from "../types/policy";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MEMO_PROGRAM_ID,
  TOKEN_PROGRAM_ID
} from "../solana/programs";

export class PolicyGuard {
  constructor(private readonly policy: PolicyConstraints) {}

  validate(transaction: VersionedTransaction): void {
    this.ensureEmergencyOverrideInactive();
    this.ensureSessionActive();

    const decompiledMessage = TransactionMessage.decompile(transaction.message);
    let totalSpendUnits = 0n;

    for (const instruction of decompiledMessage.instructions) {
      this.ensureProgramAllowed(instruction);
      this.ensureInstructionShapeAllowed(instruction);

      const spendDetails = this.tryDecodeSpend(instruction);
      if (!spendDetails) {
        continue;
      }

      const destination = spendDetails.destination.toBase58();
      if (!this.policy.whitelistedTransferDestinations.includes(destination)) {
        throw new SecurityViolationError(
          `Transfer blocked: destination ${destination} is not whitelisted.`
        );
      }

      totalSpendUnits += spendDetails.amount;
    }

    const maxSpendLamports = BigInt(this.policy.maxSpend.lamports);
    if (totalSpendUnits > maxSpendLamports) {
      throw new SecurityViolationError(
        `Transfer blocked: ${totalSpendUnits} exceeds max spend ${maxSpendLamports}.`
      );
    }
  }

  private ensureEmergencyOverrideInactive(): void {
    const status = getEmergencyLockStatus();
    if (status.locked) {
      throw new SecurityViolationError(
        status.reason ?? "Human-in-the-loop Override engaged. Transaction execution is locked."
      );
    }
  }

  private ensureSessionActive(): void {
    const expiresAt = Date.parse(this.policy.sessionExpiry.iso8601);
    if (Number.isNaN(expiresAt)) {
      throw new SecurityViolationError("Session blocked: invalid session expiry.");
    }

    if (Date.now() > expiresAt) {
      throw new SecurityViolationError("Session blocked: session has expired.");
    }
  }

  private ensureProgramAllowed(instruction: TransactionInstruction): void {
    const programId = instruction.programId.toBase58();
    if (this.policy.whitelistedPrograms.includes(programId)) {
      return;
    }

    throw new SecurityViolationError(`Program blocked: ${programId} is not whitelisted.`);
  }

  private tryDecodeSpend(instruction: TransactionInstruction): {
    amount: bigint;
    destination: PublicKey;
  } | null {
    if (instruction.programId.equals(SystemProgram.programId)) {
      try {
        const transfer = SystemInstruction.decodeTransfer(instruction);
        return {
          amount: transfer.lamports,
          destination: transfer.toPubkey
        };
      } catch {
        return null;
      }
    }

    // Parse SPL token spend instructions so token outflows are policy-constrained.
    try {
      const transfer = decodeTransferInstruction(instruction);
      return {
        amount: BigInt(transfer.data.amount.toString()),
        destination: transfer.keys.destination.pubkey
      };
    } catch {
      // Not a Transfer instruction.
    }

    try {
      const transferChecked = decodeTransferCheckedInstruction(instruction);
      return {
        amount: BigInt(transferChecked.data.amount.toString()),
        destination: transferChecked.keys.destination.pubkey
      };
    } catch {
      // Not a TransferChecked instruction.
    }

    return null;
  }

  private ensureInstructionShapeAllowed(instruction: TransactionInstruction): void {
    const blockedVector = this.detectBlockedSpendVector(instruction);
    if (blockedVector) {
      throw new SecurityViolationError(blockedVector);
    }

    if (this.tryDecodeSpend(instruction)) {
      return;
    }

    const programId = instruction.programId.toBase58();
    const knownNonSpendPrograms = [
      SystemProgram.programId.toBase58(),
      TOKEN_PROGRAM_ID.toBase58(),
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
      MEMO_PROGRAM_ID.toBase58()
    ];
    if (knownNonSpendPrograms.includes(programId)) {
      return;
    }

    throw new SecurityViolationError(`Opaque instruction blocked: ${programId} is not explicitly approved.`);
  }

  private detectBlockedSpendVector(instruction: TransactionInstruction): string | null {
    try {
      const approve = decodeApproveInstruction(instruction);
      return `Delegate approval blocked: ${approve.keys.delegate.pubkey.toBase58()}`;
    } catch {
      // ignore
    }

    try {
      const approveChecked = decodeApproveCheckedInstruction(instruction);
      return `Delegate approval blocked: ${approveChecked.keys.delegate.pubkey.toBase58()}`;
    } catch {
      // ignore
    }

    try {
      const revoke = decodeRevokeInstruction(instruction);
      return `Delegate revoke requires explicit approval: ${revoke.keys.account.pubkey.toBase58()}`;
    } catch {
      // ignore
    }

    try {
      const closeAccount = decodeCloseAccountInstruction(instruction);
      return `Close-account drain blocked: ${closeAccount.keys.destination.pubkey.toBase58()}`;
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
        return `Authority change blocked: ${AuthorityType[setAuthority.data.authorityType]}`;
      }
    } catch {
      // ignore
    }

    return null;
  }
}
