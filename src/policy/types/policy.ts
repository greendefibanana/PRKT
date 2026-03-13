import type { PublicKey, VersionedTransaction } from "@solana/web3.js";

export type ApprovalMode = "sandbox" | "live";

export type PolicyLimits = {
  maxSolPerTxLamports: number;
  maxSplPerTxRawAmount: bigint;
  maxTransactionsPerSession: number;
  maxTransactionsPerDay: number;
};

export type PolicyRules = {
  allowOpaqueProgramIds?: string[];
  allowedCloseAccountDestinations?: string[];
  allowedProgramIds: string[];
  allowedMintAddresses: string[];
  denyUnknownInstructionsByDefault: boolean;
  requireSimulationSuccess: boolean;
  rejectSuspiciousBalanceDeltas: boolean;
  allowedTransferDestinations?: string[];
};

export type PolicyConfig = {
  agentId: string;
  approvalMode: ApprovalMode;
  limits: PolicyLimits;
  rules: PolicyRules;
  sessionExpiresAtIso8601: string;
};

export type TxInspectionContext = {
  expectedBalanceDeltas?: Array<{
    account: PublicKey;
    mint?: PublicKey;
    maxNegativeDeltaRaw: bigint;
  }>;
};

export type TxInspectionResult = {
  allowed: boolean;
  reason?: string;
  reasons: string[];
  details: {
    totalSolSpendLamports: bigint;
    totalSplSpendRaw: bigint;
    programsSeen: string[];
    mintsSeen: string[];
  };
};

export type SecurityAuditEntry = {
  agentId: string;
  timestampIso8601: string;
  decision: "allow" | "deny";
  reason: string;
  txSignature?: string;
};

export type ApprovalCallback = (input: {
  agentId: string;
  inspection: TxInspectionResult;
  transaction: VersionedTransaction;
}) => Promise<boolean>;
