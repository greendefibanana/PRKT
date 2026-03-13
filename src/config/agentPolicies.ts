import { SystemProgram } from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MEMO_PROGRAM_ID,
  TOKEN_PROGRAM_ID
} from "../solana/programs";
import type { PolicyConfig } from "../policy";
import { getExtraWhitelistedPrograms, getPolicySessionTtlMinutes } from "./env";

export function createDefaultPolicyConfig(input: {
  agentId: string;
  allowOpaqueProgramIds?: string[];
  allowedCloseAccountDestinations?: string[];
  allowedMints?: string[];
  extraAllowedProgramIds?: string[];
  allowedTransferDestinations?: string[];
  approvalMode?: "sandbox" | "live";
  maxSolPerTxLamports?: number;
  maxSplPerTxRawAmount?: bigint;
  maxTransactionsPerSession?: number;
  maxTransactionsPerDay?: number;
}): PolicyConfig {
  const ttlMinutes = getPolicySessionTtlMinutes();
  return {
    agentId: input.agentId,
    approvalMode: input.approvalMode ?? "sandbox",
    sessionExpiresAtIso8601: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
    limits: {
      maxSolPerTxLamports: input.maxSolPerTxLamports ?? 1_000_000_000,
      maxSplPerTxRawAmount: input.maxSplPerTxRawAmount ?? 1_000_000_000n,
      maxTransactionsPerSession: input.maxTransactionsPerSession ?? 50,
      maxTransactionsPerDay: input.maxTransactionsPerDay ?? 500
    },
    rules: {
      allowOpaqueProgramIds: input.allowOpaqueProgramIds ?? [],
      allowedCloseAccountDestinations: input.allowedCloseAccountDestinations,
      allowedProgramIds: [
        SystemProgram.programId.toBase58(),
        TOKEN_PROGRAM_ID.toBase58(),
        ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
        MEMO_PROGRAM_ID.toBase58(),
        ...(input.extraAllowedProgramIds ?? []),
        ...getExtraWhitelistedPrograms()
      ],
      allowedMintAddresses: input.allowedMints ?? [],
      allowedTransferDestinations: input.allowedTransferDestinations,
      denyUnknownInstructionsByDefault: true,
      requireSimulationSuccess: true,
      rejectSuspiciousBalanceDeltas: true
    }
  };
}
