export type StoredWalletRecord = {
  createdAtIso: string;
  encryptedSecretKey?: WalletCiphertext;
  name: string;
  publicKey: string;
  recoveryPackage?: RecoveryPackage;
  secretKey?: number[];
  version?: 1 | 2;
};

export type WalletCiphertext = {
  algorithm: "aes-256-gcm";
  ciphertext: string;
  iv: string;
  tag: string;
};

export type RecoveryPackage = {
  algorithm: "scrypt-aes-256-gcm";
  ciphertext: string;
  iv: string;
  kdf: "scrypt";
  salt: string;
  tag: string;
};

export type ActivityKind =
  | "wallet"
  | "transfer"
  | "token"
  | "policy"
  | "agent"
  | "monitor"
  | "demo"
  | "doctor"
  | "config";

export type ActivityRecord = {
  agent?: string;
  createdAtIso: string;
  details: Record<string, unknown>;
  kind: ActivityKind;
  signature?: string;
};

export type StoredAgentRecord = {
  createdAtIso: string;
  lastAction?: string;
  lastError?: string;
  lastRunAtIso?: string;
  lastSignature?: string;
  name: string;
  ownerId?: string;
  policyMode: "sandbox" | "live";
  policyOverrides?: StoredPolicyOverrides;
  policyPreset: PolicyPresetName;
  status: "active" | "stopped";
  strategy: string;
  strategyConfig?: Record<string, unknown>;
  trackedMints?: string[];
  walletName: string;
};

export type PolicyPresetName =
  | "observe-only"
  | "simulate-only"
  | "auto-devnet-safe"
  | "guarded-live"
  | "custom";

export type StoredPolicyOverrides = {
  allowOpaqueProgramIds?: string[];
  allowedCloseAccountDestinations?: string[];
  allowedMints?: string[];
  allowedTransferDestinations?: string[];
  approvalMode?: "sandbox" | "live";
  denyUnknownInstructionsByDefault?: boolean;
  extraAllowedProgramIds?: string[];
  maxSolPerTxLamports?: number;
  maxSplPerTxRawAmount?: string;
  maxTransactionsPerDay?: number;
  maxTransactionsPerSession?: number;
  rejectSuspiciousBalanceDeltas?: boolean;
  requireSimulationSuccess?: boolean;
  sessionTtlMinutes?: number;
};

export type CliOutputOptions = {
  json: boolean;
};
