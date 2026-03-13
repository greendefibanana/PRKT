import {
  PublicKey,
  SystemProgram,
  type TransactionConfirmationStrategy,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction
} from "@solana/web3.js";
import {
  createTransferCheckedInstruction,
  createTransferInstruction
} from "@solana/spl-token";

import type {
  BuiltTransaction,
  SendResult,
  SendableTransaction,
  SimulationResult
} from "../types/services";
import { RpcClient } from "../rpc/RpcClient";
import { WalletManager } from "../wallet/WalletManager";
import { MEMO_PROGRAM_ID } from "../../solana/programs";

const LAMPORTS_PER_SOL = 1_000_000_000;

export class TransactionService {
  constructor(private readonly rpcClient: RpcClient) {}

  async buildTransaction(input: {
    feePayer: PublicKey;
    instructions: TransactionInstruction[];
    signer: WalletManager;
  }): Promise<BuiltTransaction> {
    const latestBlockhash = await this.rpcClient.getLatestBlockhash("confirmed");
    const message = new TransactionMessage({
      payerKey: input.feePayer,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: input.instructions
    }).compileToV0Message();

    const transaction = new VersionedTransaction(message);
    const signedTransaction = await input.signer.signTransaction(transaction);

    return {
      confirmationStrategy: {
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        signature: ""
      },
      instructionsCount: input.instructions.length,
      transaction: signedTransaction
    };
  }

  buildSolTransferInstruction(input: {
    from: PublicKey;
    to: PublicKey;
    lamports: number;
  }): TransactionInstruction {
    return SystemProgram.transfer({
      fromPubkey: input.from,
      toPubkey: input.to,
      lamports: input.lamports
    });
  }

  buildSolTransferInstructionInSol(input: {
    from: PublicKey;
    to: PublicKey;
    amountSol: number;
  }): TransactionInstruction {
    const lamports = Math.round(input.amountSol * LAMPORTS_PER_SOL);
    return this.buildSolTransferInstruction({
      from: input.from,
      to: input.to,
      lamports
    });
  }

  buildSplTransferInstruction(input: {
    sourceAta: PublicKey;
    destinationAta: PublicKey;
    owner: PublicKey;
    amount: bigint;
    multiSigners?: PublicKey[];
    programId?: PublicKey;
  }): TransactionInstruction {
    return createTransferInstruction(
      input.sourceAta,
      input.destinationAta,
      input.owner,
      input.amount,
      input.multiSigners,
      input.programId
    );
  }

  buildSplTransferCheckedInstruction(input: {
    sourceAta: PublicKey;
    mint: PublicKey;
    destinationAta: PublicKey;
    owner: PublicKey;
    amount: bigint;
    decimals: number;
    multiSigners?: PublicKey[];
    programId?: PublicKey;
  }): TransactionInstruction {
    return createTransferCheckedInstruction(
      input.sourceAta,
      input.mint,
      input.destinationAta,
      input.owner,
      input.amount,
      input.decimals,
      input.multiSigners,
      input.programId
    );
  }

  buildMemoInstruction(memo: string): TransactionInstruction {
    return new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(memo, "utf8")
    });
  }

  async simulate(transaction: VersionedTransaction): Promise<SimulationResult> {
    const simulation = await this.rpcClient.simulateTransaction(transaction, {
      commitment: "confirmed",
      sigVerify: true
    });
    return {
      err: simulation.value.err,
      logs: simulation.value.logs ?? null,
      unitsConsumed: simulation.value.unitsConsumed ?? null
    };
  }

  async sendAndConfirm(input: SendableTransaction): Promise<SendResult> {
    const sendable = this.normalizeSendable(input);
    const signature = await this.rpcClient.sendTransaction(sendable.transaction, {
      maxRetries: 3,
      preflightCommitment: "confirmed"
    });

    const confirmation = await this.rpcClient.confirmTransaction(
      this.resolveConfirmationTarget(sendable.confirmationStrategy, signature),
      "confirmed"
    );

    return {
      signature,
      slot: confirmation.context.slot
    };
  }

  private normalizeSendable(input: SendableTransaction): {
    confirmationStrategy?: TransactionConfirmationStrategy | string;
    transaction: VersionedTransaction;
  } {
    if (input instanceof VersionedTransaction) {
      return {
        transaction: input
      };
    }

    return input;
  }

  private resolveConfirmationTarget(
    confirmationStrategy: TransactionConfirmationStrategy | string | undefined,
    signature: string
  ): TransactionConfirmationStrategy | string {
    if (!confirmationStrategy) {
      return signature;
    }

    if (typeof confirmationStrategy === "string") {
      return confirmationStrategy;
    }

    return {
      ...confirmationStrategy,
      signature
    };
  }
}
