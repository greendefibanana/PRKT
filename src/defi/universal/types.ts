import type {
  TransactionConfirmationStrategy,
  VersionedTransaction
} from "@solana/web3.js";

import type { PolicyConfig, SandboxExecutionResult, TxInspectionContext } from "../../policy";
import type { SupportedProtocol } from "../../types/policy";
import type { DeFiExecutionResult, DeFiIntent, MarketSnapshot } from "../types";

export type DeFiCapability = "trade" | "lp" | "lending" | "borrowing" | "yield" | "staking";

export type UniversalDeFiRequest = {
  capability: DeFiCapability;
  protocol?: SupportedProtocol;
  snapshot: MarketSnapshot;
};

export type PolicyConfigPatch = {
  limits?: Partial<PolicyConfig["limits"]>;
  rules?: Partial<PolicyConfig["rules"]>;
  sessionExpiresAtIso8601?: string;
};

export type PreparedLiveExecution = {
  confirmationStrategy?: TransactionConfirmationStrategy | string;
  inspectionContext?: TxInspectionContext;
  policyConfigPatch?: PolicyConfigPatch;
  protocol: SupportedProtocol;
  toExecutionResult(signature: string): DeFiExecutionResult;
  transaction: VersionedTransaction;
  verifyExecution?: (signature: string) => Promise<void>;
};

export type GuardedPreparedTransactionExecutor = {
  executePreparedTransaction(input: {
    confirmationStrategy?: TransactionConfirmationStrategy | string;
    inspectionContext?: TxInspectionContext;
    policyConfigPatch?: PolicyConfigPatch;
    transaction: VersionedTransaction;
  }): Promise<SandboxExecutionResult>;
};

export interface UniversalDeFiAdapter {
  readonly capabilities: readonly DeFiCapability[];
  readonly protocol: SupportedProtocol;
  buildIntent(request: UniversalDeFiRequest): DeFiIntent | null;
}

export type UniversalExecutionOptions = {
  liveExecutor?: GuardedPreparedTransactionExecutor;
};

export type UniversalExecutionResult = {
  capability: DeFiCapability;
  protocol: SupportedProtocol;
  result: DeFiExecutionResult | null;
};
