import {
  Connection,
  type Commitment,
  type ConfirmOptions,
  type PublicKey,
  type RpcResponseAndContext,
  type SignatureResult,
  type SimulatedTransactionResponse,
  type TransactionConfirmationStrategy,
  type VersionedTransaction
} from "@solana/web3.js";

import { getRpcFallbackUrl, getRpcUrl } from "../../config/env";
import { RpcFailoverClient } from "./RpcFailoverClient";

export class RpcClient {
  readonly connection: Connection;
  private readonly failoverClient: RpcFailoverClient | null;

  constructor(
    rpcUrl = getRpcUrl(),
    commitment: Commitment = "confirmed"
  ) {
    this.connection = new Connection(rpcUrl, commitment);
    const fallbackUrl = getRpcFallbackUrl();
    this.failoverClient =
      fallbackUrl && fallbackUrl !== rpcUrl
        ? new RpcFailoverClient({
            commitment,
            fallbackUrl,
            primaryUrl: rpcUrl
          })
        : null;
  }

  get rpcUrl(): string {
    return this.connection.rpcEndpoint;
  }

  async getLatestBlockhash(commitment: Commitment = "confirmed"): Promise<{
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    if (this.failoverClient) {
      return this.failoverClient.getLatestBlockhash(commitment);
    }

    return this.connection.getLatestBlockhash(commitment);
  }

  async getBalance(publicKey: PublicKey, commitment: Commitment = "confirmed"): Promise<number> {
    if (this.failoverClient) {
      return this.failoverClient.getBalance(publicKey, commitment);
    }

    return this.connection.getBalance(publicKey, commitment);
  }

  async getTokenAccountBalance(publicKey: PublicKey, commitment: Commitment = "confirmed") {
    if (this.failoverClient) {
      return this.failoverClient.getTokenAccountBalance(publicKey, commitment);
    }

    return this.connection.getTokenAccountBalance(publicKey, commitment);
  }

  async getAccountInfo(publicKey: PublicKey, commitment: Commitment = "confirmed") {
    if (this.failoverClient) {
      return this.failoverClient.getAccountInfo(publicKey, commitment);
    }

    return this.connection.getAccountInfo(publicKey, commitment);
  }

  async sendTransaction(
    transaction: VersionedTransaction,
    options?: ConfirmOptions
  ): Promise<string> {
    if (this.failoverClient) {
      return this.failoverClient.sendTransaction(transaction, options);
    }

    return this.connection.sendTransaction(transaction, options);
  }

  async confirmTransaction(
    strategy: TransactionConfirmationStrategy | string,
    commitment: Commitment = "confirmed"
  ): Promise<RpcResponseAndContext<SignatureResult>> {
    if (this.failoverClient) {
      return this.failoverClient.confirmTransaction(strategy, commitment);
    }

    if (typeof strategy === "string") {
      return this.connection.confirmTransaction(strategy, commitment);
    }

    return this.connection.confirmTransaction(strategy, commitment);
  }

  async simulateTransaction(
    transaction: VersionedTransaction,
    options?: {
      commitment?: Commitment;
      sigVerify?: boolean;
    }
  ): Promise<RpcResponseAndContext<SimulatedTransactionResponse>> {
    if (this.failoverClient) {
      return this.failoverClient.simulateTransaction(transaction, options);
    }

    return this.connection.simulateTransaction(transaction, {
      commitment: options?.commitment ?? "confirmed",
      sigVerify: options?.sigVerify ?? true
    });
  }

  async requestAirdrop(publicKey: PublicKey, lamports: number): Promise<string> {
    if (this.failoverClient) {
      return this.failoverClient.requestAirdrop(publicKey, lamports);
    }

    return this.connection.requestAirdrop(publicKey, lamports);
  }
}
