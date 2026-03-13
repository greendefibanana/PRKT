import { createHash } from "crypto";

import {
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction
} from "@solana/web3.js";

import { WalletManager } from "../wallet/WalletManager";
import { KoraRpcClient } from "./KoraRpcClient";
import { MEMO_PROGRAM_ID, MOCK_BLOCKHASH } from "../solana/programs";

export type GaslessExecutionResult = {
  endpoint: string;
  fallbackReason?: string;
  memo: string;
  mock: boolean;
  signature: string;
};

export class KoraSigner {
  constructor(
    private readonly client: KoraRpcClient,
    private readonly options: {
      fallbackToMockOnError?: boolean;
      mockMode: boolean;
    }
  ) {}

  async buildMemoTransaction(walletManager: WalletManager, memo: string): Promise<VersionedTransaction> {
    let recentBlockhash = MOCK_BLOCKHASH;
    if (!this.options.mockMode) {
      try {
        recentBlockhash = await this.client.getBlockhash();
      } catch (error: unknown) {
        if (!this.options.fallbackToMockOnError) {
          throw error;
        }
      }
    }

    const memoInstruction = new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(memo, "utf8")
    });

    const message = new TransactionMessage({
      payerKey: walletManager.publicKey,
      recentBlockhash,
      instructions: [memoInstruction]
    }).compileToV0Message();

    const transaction = new VersionedTransaction(message);
    return walletManager.signTransaction(transaction);
  }

  async signAndSendGasless(transaction: VersionedTransaction, memo: string): Promise<GaslessExecutionResult> {
    const serializedTransaction = Buffer.from(transaction.serialize()).toString("base64");

    if (this.options.mockMode) {
      return {
        endpoint: this.client.rpcUrl,
        memo,
        mock: true,
        signature: this.createMockSignature(serializedTransaction)
      };
    }

    try {
      const { signature } = await this.client.signAndSendTransaction(serializedTransaction);

      return {
        endpoint: this.client.rpcUrl,
        memo,
        mock: false,
        signature
      };
    } catch (error: unknown) {
      if (!this.options.fallbackToMockOnError) {
        throw error;
      }

      const fallbackReason = error instanceof Error ? error.message : "unknown Kora RPC error";
      return {
        endpoint: this.client.rpcUrl,
        fallbackReason,
        memo,
        mock: true,
        signature: this.createMockSignature(serializedTransaction)
      };
    }
  }

  async submitGaslessMemo(walletManager: WalletManager, memo: string): Promise<GaslessExecutionResult> {
    const transaction = await this.buildMemoTransaction(walletManager, memo);
    return this.signAndSendGasless(transaction, memo);
  }

  private createMockSignature(serializedTransaction: string): string {
    return createHash("sha256").update(serializedTransaction).digest("hex");
  }
}
