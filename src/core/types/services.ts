import type {
  PublicKey,
  TransactionConfirmationStrategy,
  VersionedTransaction
} from "@solana/web3.js";

import type { WalletManager } from "../wallet/WalletManager";

export type BuiltTransaction = {
  confirmationStrategy: TransactionConfirmationStrategy;
  instructionsCount: number;
  transaction: VersionedTransaction;
};

export type SendableTransaction =
  | VersionedTransaction
  | {
      confirmationStrategy?: TransactionConfirmationStrategy | string;
      transaction: VersionedTransaction;
    };

export type SimulationResult = {
  err: unknown;
  logs: string[] | null;
  unitsConsumed: number | null;
};

export type SendResult = {
  signature: string;
  slot?: number;
};

export type TokenAccountDetails = {
  address: PublicKey;
  existed: boolean;
};

export type WalletServiceDependencies = {
  walletManager: WalletManager;
};
