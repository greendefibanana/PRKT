import {
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createSyncNativeInstruction,
  getMint,
  getAssociatedTokenAddressSync
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction
} from "@solana/web3.js";

import { RpcClient } from "../rpc/RpcClient";
import { WalletManager } from "../wallet/WalletManager";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID
} from "../../solana/programs";

export class TokenService {
  constructor(private readonly rpcClient: RpcClient) {}

  async getMintDecimals(mint: PublicKey): Promise<number> {
    const mintInfo = await getMint(this.rpcClient.connection, mint, "confirmed");
    return mintInfo.decimals;
  }

  findAssociatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
    return getAssociatedTokenAddressSync(
      mint,
      owner,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
  }

  async ensureAtaInstruction(input: {
    mint: PublicKey;
    owner: PublicKey;
    payer: PublicKey;
  }): Promise<{
    address: PublicKey;
    createInstruction: TransactionInstruction | null;
  }> {
    const address = this.findAssociatedTokenAddress(input.owner, input.mint);
    const accountInfo = await this.rpcClient.getAccountInfo(address, "confirmed");

    if (accountInfo) {
      return {
        address,
        createInstruction: null
      };
    }

    return {
      address,
      createInstruction: createAssociatedTokenAccountInstruction(
        input.payer,
        address,
        input.owner,
        input.mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    };
  }

  buildWrapSolInstructions(input: {
    wallet: WalletManager;
    amountLamports: number;
    createAtaIfMissing: boolean;
  }): {
    associatedTokenAddress: PublicKey;
    createdAssociatedTokenAccount: boolean;
    instructions: TransactionInstruction[];
  } {
    if (!Number.isInteger(input.amountLamports) || input.amountLamports <= 0) {
      throw new Error("Wrap SOL amount must be a positive integer lamport value.");
    }

    const associatedTokenAddress = this.findAssociatedTokenAddress(input.wallet.publicKey, NATIVE_MINT);
    const instructions: TransactionInstruction[] = [];

    if (input.createAtaIfMissing) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          input.wallet.publicKey,
          associatedTokenAddress,
          input.wallet.publicKey,
          NATIVE_MINT,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }

    instructions.push(
      SystemProgram.transfer({
        fromPubkey: input.wallet.publicKey,
        toPubkey: associatedTokenAddress,
        lamports: input.amountLamports
      }),
      createSyncNativeInstruction(associatedTokenAddress, TOKEN_PROGRAM_ID)
    );

    return {
      associatedTokenAddress,
      createdAssociatedTokenAccount: input.createAtaIfMissing,
      instructions
    };
  }

  async buildCreateMintInstructions(input: {
    payer: PublicKey;
    mintAuthority: PublicKey;
    decimals: number;
  }): Promise<{
    mintKeypair: Keypair;
    instructions: TransactionInstruction[];
  }> {
    const mintKeypair = Keypair.generate();
    const rent = await this.rpcClient.connection.getMinimumBalanceForRentExemption(82);

    const instructions: TransactionInstruction[] = [
      SystemProgram.createAccount({
        fromPubkey: input.payer,
        newAccountPubkey: mintKeypair.publicKey,
        lamports: rent,
        programId: TOKEN_PROGRAM_ID,
        space: 82
      }),
      createInitializeMint2Instruction(
        mintKeypair.publicKey,
        input.decimals,
        input.mintAuthority,
        input.mintAuthority,
        TOKEN_PROGRAM_ID
      )
    ];

    return {
      mintKeypair,
      instructions
    };
  }

  buildMintToInstruction(input: {
    mint: PublicKey;
    destinationAta: PublicKey;
    authority: PublicKey;
    amount: bigint;
  }): TransactionInstruction {
    return createMintToInstruction(
      input.mint,
      input.destinationAta,
      input.authority,
      input.amount,
      [],
      TOKEN_PROGRAM_ID
    );
  }
}
