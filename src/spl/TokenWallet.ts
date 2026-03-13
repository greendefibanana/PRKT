import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction
} from "@solana/web3.js";

import { WalletManager } from "../wallet/WalletManager";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID
} from "../solana/programs";

export type WrapSolTransactionBuildResult = {
  associatedTokenAddress: PublicKey;
  createdAssociatedTokenAccount: boolean;
  transaction: VersionedTransaction;
};

export class TokenWallet {
  static findAssociatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
    const [associatedTokenAddress] = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    return associatedTokenAddress;
  }

  static async buildWrapSolTransaction(input: {
    amountLamports: number;
    createAssociatedTokenAccount: boolean;
    recentBlockhash: string;
    walletManager: WalletManager;
  }): Promise<WrapSolTransactionBuildResult> {
    if (!Number.isInteger(input.amountLamports) || input.amountLamports <= 0) {
      throw new Error("Wrap SOL amount must be a positive integer lamport value.");
    }

    const associatedTokenAddress = TokenWallet.findAssociatedTokenAddress(
      input.walletManager.publicKey,
      NATIVE_MINT
    );

    const instructions: TransactionInstruction[] = [];

    if (input.createAssociatedTokenAccount) {
      instructions.push(
        TokenWallet.createAssociatedTokenAccountInstruction({
          mint: NATIVE_MINT,
          owner: input.walletManager.publicKey,
          payer: input.walletManager.publicKey
        })
      );
    }

    instructions.push(
      SystemProgram.transfer({
        fromPubkey: input.walletManager.publicKey,
        toPubkey: associatedTokenAddress,
        lamports: input.amountLamports
      }),
      TokenWallet.createSyncNativeInstruction(associatedTokenAddress)
    );

    const message = new TransactionMessage({
      payerKey: input.walletManager.publicKey,
      recentBlockhash: input.recentBlockhash,
      instructions
    }).compileToV0Message();

    const transaction = new VersionedTransaction(message);
    const signedTransaction = await input.walletManager.signTransaction(transaction);

    return {
      associatedTokenAddress,
      createdAssociatedTokenAccount: input.createAssociatedTokenAccount,
      transaction: signedTransaction
    };
  }

  private static createAssociatedTokenAccountInstruction(input: {
    mint: PublicKey;
    owner: PublicKey;
    payer: PublicKey;
  }): TransactionInstruction {
    const associatedTokenAddress = TokenWallet.findAssociatedTokenAddress(input.owner, input.mint);

    return new TransactionInstruction({
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: input.payer, isSigner: true, isWritable: true },
        { pubkey: associatedTokenAddress, isSigner: false, isWritable: true },
        { pubkey: input.owner, isSigner: false, isWritable: false },
        { pubkey: input.mint, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
      ],
      data: Buffer.alloc(0)
    });
  }

  private static createSyncNativeInstruction(associatedTokenAddress: PublicKey): TransactionInstruction {
    return new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [{ pubkey: associatedTokenAddress, isSigner: false, isWritable: true }],
      data: Buffer.from([17])
    });
  }
}
