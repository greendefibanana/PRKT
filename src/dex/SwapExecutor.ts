import { LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from "@solana/web3.js";

import { PolicyGuard } from "../policy/PolicyGuard";
import { KoraSigner, type GaslessExecutionResult } from "../kora/KoraSigner";
import { WalletManager } from "../wallet/WalletManager";
import { JupiterSwapClient } from "./JupiterSwapClient";

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

export type LiveSwapResult = {
  execution: GaslessExecutionResult;
  outputMint: string;
  quoteOutAmount: string;
  routeType: "jupiter";
};

export type PreparedSwapTransaction = {
  outputMint: string;
  quoteOutAmount: string;
  routeType: "jupiter";
  transaction: VersionedTransaction;
};

export class SwapExecutor {
  constructor(private readonly jupiterClient: JupiterSwapClient) {}

  async buildSolToTokenSwapTransaction(input: {
    amountSol: number;
    outputMint: string;
    slippageBps?: number;
    walletManager: WalletManager;
  }): Promise<PreparedSwapTransaction> {
    const quote = await this.jupiterClient.getQuote({
      inputMint: WRAPPED_SOL_MINT,
      outputMint: input.outputMint,
      amount: BigInt(Math.round(input.amountSol * LAMPORTS_PER_SOL)),
      slippageBps: input.slippageBps ?? 50
    });

    const swapTransactionBase64 = await this.jupiterClient.buildSwapTransaction({
      quoteResponse: quote,
      userPublicKey: input.walletManager.publicKey
    });

    const transaction = VersionedTransaction.deserialize(
      Buffer.from(swapTransactionBase64, "base64")
    );
    const signedTransaction = await input.walletManager.signTransaction(transaction);

    return {
      outputMint: input.outputMint,
      quoteOutAmount: quote.outAmount,
      routeType: "jupiter",
      transaction: signedTransaction
    };
  }

  async executeSolToTokenSwap(input: {
    amountSol: number;
    koraSigner: KoraSigner;
    outputMint: string;
    policyGuard: PolicyGuard;
    slippageBps?: number;
    walletManager: WalletManager;
  }): Promise<LiveSwapResult> {
    const prepared = await this.buildSolToTokenSwapTransaction({
      amountSol: input.amountSol,
      outputMint: input.outputMint,
      slippageBps: input.slippageBps,
      walletManager: input.walletManager
    });

    const transaction = prepared.transaction;
    input.policyGuard.validate(transaction);

    const execution = await input.koraSigner.signAndSendGasless(
      transaction,
      `JUPITER_SWAP:${input.amountSol.toFixed(2)} SOL->${input.outputMint}`
    );

    return {
      execution,
      outputMint: prepared.outputMint,
      quoteOutAmount: prepared.quoteOutAmount,
      routeType: prepared.routeType
    };
  }

  static isLikelySolMint(mintAddress: string): boolean {
    return new PublicKey(mintAddress).toBase58() === WRAPPED_SOL_MINT;
  }
}
