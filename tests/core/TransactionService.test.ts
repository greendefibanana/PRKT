import {
  Keypair,
  TransactionMessage,
  VersionedTransaction
} from "@solana/web3.js";

import { TransactionService } from "../../src/core/transactions/TransactionService";
import { WalletManager } from "../../src/core/wallet/WalletManager";

describe("TransactionService", () => {
  it("confirms built transactions with their original blockhash context", async () => {
    const rpcClient = {
      confirmTransaction: jest.fn(async () => ({
        context: { slot: 7 },
        value: { err: null }
      })),
      getLatestBlockhash: jest.fn(async () => ({
        blockhash: "11111111111111111111111111111111",
        lastValidBlockHeight: 42
      })),
      sendTransaction: jest.fn(async () => "built-signature"),
      simulateTransaction: jest.fn()
    };
    const service = new TransactionService(rpcClient as never);
    const signer = WalletManager.generate();

    const built = await service.buildTransaction({
      feePayer: signer.publicKey,
      instructions: [],
      signer
    });

    await service.sendAndConfirm(built);

    expect(rpcClient.confirmTransaction).toHaveBeenCalledWith(
      {
        blockhash: "11111111111111111111111111111111",
        lastValidBlockHeight: 42,
        signature: "built-signature"
      },
      "confirmed"
    );
  });

  it("falls back to signature-based confirmation for externally prepared transactions", async () => {
    const rpcClient = {
      confirmTransaction: jest.fn(async () => ({
        context: { slot: 9 },
        value: { err: null }
      })),
      getLatestBlockhash: jest.fn(),
      sendTransaction: jest.fn(async () => "external-signature"),
      simulateTransaction: jest.fn()
    };
    const service = new TransactionService(rpcClient as never);
    const payer = Keypair.generate();
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        instructions: [],
        payerKey: payer.publicKey,
        recentBlockhash: "11111111111111111111111111111111"
      }).compileToV0Message()
    );
    transaction.sign([payer]);

    await service.sendAndConfirm(transaction);

    expect(rpcClient.confirmTransaction).toHaveBeenCalledWith(
      "external-signature",
      "confirmed"
    );
  });
});
