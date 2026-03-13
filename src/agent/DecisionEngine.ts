import type {
  AccountInfo,
  Commitment,
  PublicKey,
  SendOptions,
  SignatureResult,
  TransactionConfirmationStrategy,
  VersionedTransaction
} from "@solana/web3.js";

import { createDefaultAgentPolicy } from "./policyFactory";
import { PolicyGuard } from "../policy/PolicyGuard";
import { NATIVE_MINT } from "../solana/programs";
import { TokenWallet } from "../spl/TokenWallet";
import { WalletManager } from "../wallet/WalletManager";

const MINIMUM_WSOL_FOR_TRADING = 0.01;
const MINIMUM_SOL_RESERVE = 0.1;
const WRAP_SOL_AMOUNT = 0.05;
const LAMPORTS_PER_SOL = 1_000_000_000;
const ANSI_CYAN = "\u001b[36m";
const ANSI_RESET = "\u001b[0m";

export type DecisionEngineConnection = {
  confirmTransaction(
    strategy: TransactionConfirmationStrategy,
    commitment?: Commitment
  ): Promise<RpcResponseAndContext<SignatureResult>>;
  getAccountInfo(
    publicKey: PublicKey,
    commitment?: Commitment
  ): Promise<AccountInfo<Buffer> | null>;
  getBalance(publicKey: PublicKey, commitment?: Commitment): Promise<number>;
  getLatestBlockhash(
    commitment?: Commitment
  ): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  getTokenAccountBalance(
    publicKey: PublicKey,
    commitment?: Commitment
  ): Promise<RpcResponseAndContext<TokenAccountBalanceValue>>;
  sendTransaction(
    transaction: VersionedTransaction,
    options?: SendOptions
  ): Promise<string>;
};

type RpcResponseAndContext<T> = {
  context: {
    apiVersion?: string;
    slot: number;
  };
  value: T;
};

type TokenAccountBalanceValue = {
  amount: string;
  decimals: number;
  uiAmount: number | null;
  uiAmountString?: string;
};

export type DecisionResult =
  | {
      action: "hold";
      associatedTokenAddress: string;
      reason: string;
      solBalance: number;
      wsolBalance: number;
    }
  | {
      action: "wrap";
      associatedTokenAddress: string;
      createdAssociatedTokenAccount: boolean;
      reason: string;
      signature: string;
      solBalance: number;
      wrapAmount: number;
      wsolBalance: number;
    };

export class DecisionEngine {
  constructor(
    private readonly connection: DecisionEngineConnection,
    private readonly walletManager: WalletManager,
    private readonly logger: (message: string) => void = console.log
  ) {}

  async think(): Promise<DecisionResult> {
    const associatedTokenAddress = TokenWallet.findAssociatedTokenAddress(
      this.walletManager.publicKey,
      NATIVE_MINT
    );
    const existingTokenAccount = await this.connection.getAccountInfo(
      associatedTokenAddress,
      "confirmed"
    );
    const solBalanceLamports = await this.connection.getBalance(
      this.walletManager.publicKey,
      "confirmed"
    );
    const wsolBalance = await this.getWsolBalance(associatedTokenAddress, existingTokenAccount !== null);
    const solBalance = solBalanceLamports / LAMPORTS_PER_SOL;

    this.logger(`SOL balance: ${solBalance.toFixed(4)} SOL`);
    this.logger(`wSOL balance: ${wsolBalance.toFixed(4)} wSOL`);

    if (wsolBalance < MINIMUM_WSOL_FOR_TRADING && solBalance > MINIMUM_SOL_RESERVE) {
      const reason =
        "Reasoning: My wSOL liquidity is low for trading. I am initiating a 0.05 SOL wrap to maintain operational readiness.";
      this.logger(colorizeReasoning(reason));

      const latestBlockhash = await this.connection.getLatestBlockhash("confirmed");
      const wrapLamports = Math.round(WRAP_SOL_AMOUNT * LAMPORTS_PER_SOL);
      const wrapSol = await TokenWallet.buildWrapSolTransaction({
        amountLamports: wrapLamports,
        createAssociatedTokenAccount: existingTokenAccount === null,
        recentBlockhash: latestBlockhash.blockhash,
        walletManager: this.walletManager
      });

      const policyGuard = new PolicyGuard(
        createDefaultAgentPolicy({
          maxSpend: {
            lamports: wrapLamports + 1_000_000
          },
          whitelistedTransferDestinations: [wrapSol.associatedTokenAddress.toBase58()]
        })
      );
      policyGuard.validate(wrapSol.transaction);

      const signature = await this.connection.sendTransaction(wrapSol.transaction, {
        maxRetries: 3,
        preflightCommitment: "confirmed"
      });

      await this.connection.confirmTransaction(
        {
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          signature
        },
        "confirmed"
      );

      const updatedWsolBalance = await this.getWsolBalance(wrapSol.associatedTokenAddress, true);

      return {
        action: "wrap",
        associatedTokenAddress: wrapSol.associatedTokenAddress.toBase58(),
        createdAssociatedTokenAccount: wrapSol.createdAssociatedTokenAccount,
        reason,
        signature,
        solBalance,
        wrapAmount: WRAP_SOL_AMOUNT,
        wsolBalance: updatedWsolBalance
      };
    }

    const reason = "Reasoning: My current SOL and wSOL balances are sufficient. No liquidity adjustment is required.";
    this.logger(colorizeReasoning(reason));

    return {
      action: "hold",
      associatedTokenAddress: associatedTokenAddress.toBase58(),
      reason,
      solBalance,
      wsolBalance
    };
  }

  private async getWsolBalance(
    associatedTokenAddress: PublicKey,
    tokenAccountExists: boolean
  ): Promise<number> {
    if (!tokenAccountExists) {
      return 0;
    }

    const tokenBalance = await this.connection.getTokenAccountBalance(
      associatedTokenAddress,
      "confirmed"
    );
    const uiAmount = tokenBalance.value.uiAmount;
    if (uiAmount !== null && uiAmount !== undefined) {
      return uiAmount;
    }

    return Number(tokenBalance.value.amount) / LAMPORTS_PER_SOL;
  }
}

function colorizeReasoning(message: string): string {
  return `${ANSI_CYAN}${message}${ANSI_RESET}`;
}
