import { LAMPORTS_PER_SOL, type PublicKey } from "@solana/web3.js";

import { getOptionalDevnetTreasurySecretKey } from "../../config/env";
import { BalanceService } from "../balances/BalanceService";
import { RpcClient } from "../rpc/RpcClient";
import { TransactionService } from "../transactions/TransactionService";
import { WalletManager } from "../wallet/WalletManager";

type FundingResult = {
  signature: string;
  source: "airdrop" | "hybrid" | "treasury-transfer";
};

const TREASURY_MINIMUM_REMAINING_LAMPORTS = Math.round(0.05 * LAMPORTS_PER_SOL);

export class DevnetFundingService {
  private readonly treasuryWallet: WalletManager | null;

  constructor(
    private readonly rpcClient: RpcClient,
    private readonly transactionService: TransactionService,
    treasuryWallet: WalletManager | null = loadTreasuryWalletFromEnv()
  ) {
    this.treasuryWallet = treasuryWallet;
  }

  hasTreasuryWallet(): boolean {
    return this.treasuryWallet !== null;
  }

  getTreasuryPublicKey(): PublicKey | null {
    return this.treasuryWallet?.publicKey ?? null;
  }

  async ensureMinimumSol(input: {
    airdropAmountSol?: number;
    balanceService: BalanceService;
    minimumSol: number;
    recipient: PublicKey;
  }): Promise<FundingResult | null> {
    const currentBalance = await input.balanceService.getSolBalance(input.recipient);
    if (currentBalance >= input.minimumSol) {
      return null;
    }

    const amountSol = roundSolAmount(input.minimumSol - currentBalance);
    if (this.canUseTreasury(input.recipient)) {
      return this.fundFromTreasuryOrAirdrop({
        airdropAmountSol: input.airdropAmountSol ?? amountSol,
        amountSol,
        recipient: input.recipient
      });
    }

    return this.requestAirdrop({
      amountSol: input.airdropAmountSol ?? amountSol,
      recipient: input.recipient
    });
  }

  async fundExactSol(input: {
    amountSol: number;
    recipient: PublicKey;
  }): Promise<FundingResult> {
    if (this.canUseTreasury(input.recipient)) {
      return this.fundFromTreasuryOrAirdrop({
        airdropAmountSol: input.amountSol,
        amountSol: input.amountSol,
        recipient: input.recipient
      });
    }

    return this.requestAirdrop(input);
  }

  async waitForMinimumBalance(input: {
    attempts?: number;
    balanceService: BalanceService;
    minimumSol: number;
    recipient: PublicKey;
  }): Promise<number> {
    const attempts = input.attempts ?? 10;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const updatedBalance = await input.balanceService.getSolBalance(input.recipient);
      if (updatedBalance >= input.minimumSol) {
        return updatedBalance;
      }

      await delay(1_000);
    }

    return input.balanceService.getSolBalance(input.recipient);
  }

  private canUseTreasury(recipient: PublicKey): boolean {
    return (
      this.treasuryWallet !== null &&
      !this.treasuryWallet.publicKey.equals(recipient)
    );
  }

  private async fundFromTreasury(input: {
    amountSol: number;
    recipient: PublicKey;
  }): Promise<FundingResult> {
    if (!this.treasuryWallet) {
      throw new Error("Treasury wallet is not configured.");
    }

    const built = await this.transactionService.buildTransaction({
      feePayer: this.treasuryWallet.publicKey,
      instructions: [
        this.transactionService.buildSolTransferInstructionInSol({
          amountSol: input.amountSol,
          from: this.treasuryWallet.publicKey,
          to: input.recipient
        })
      ],
      signer: this.treasuryWallet
    });
    const send = await this.transactionService.sendAndConfirm(built);

    return {
      signature: send.signature,
      source: "treasury-transfer"
    };
  }

  private async fundFromTreasuryOrAirdrop(input: {
    airdropAmountSol: number;
    amountSol: number;
    recipient: PublicKey;
  }): Promise<FundingResult> {
    try {
      const treasuryLamports = await this.rpcClient.getBalance(this.treasuryWallet!.publicKey, "confirmed");
      const requestedLamports = Math.round(input.amountSol * LAMPORTS_PER_SOL);
      const transferableLamports = Math.max(0, treasuryLamports - TREASURY_MINIMUM_REMAINING_LAMPORTS);

      if (transferableLamports >= requestedLamports) {
        return await this.fundFromTreasury({
          amountSol: input.amountSol,
          recipient: input.recipient
        });
      }

      if (transferableLamports > 0) {
        await this.fundFromTreasury({
          amountSol: transferableLamports / LAMPORTS_PER_SOL,
          recipient: input.recipient
        });
        const remainingLamports = requestedLamports - transferableLamports;
        const airdropFunding = await this.requestAirdrop({
          amountSol: remainingLamports / LAMPORTS_PER_SOL,
          recipient: input.recipient
        });

        return {
          signature: airdropFunding.signature,
          source: "hybrid"
        };
      }
    } catch {
      // Fall through to full-faucet funding below.
    }

    return this.requestAirdrop({
      amountSol: input.airdropAmountSol,
      recipient: input.recipient
    });
  }

  private async requestAirdrop(input: {
    amountSol: number;
    recipient: PublicKey;
  }): Promise<FundingResult> {
    let remainingLamports = Math.round(input.amountSol * LAMPORTS_PER_SOL);
    let lastSignature = "";
    let lastError: unknown;

    while (remainingLamports > 0) {
      const requestLamports = Math.min(remainingLamports, LAMPORTS_PER_SOL);
      let requestSucceeded = false;

      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          lastSignature = await this.rpcClient.requestAirdrop(input.recipient, requestLamports);
          await this.rpcClient.confirmTransaction(lastSignature, "confirmed");
          remainingLamports -= requestLamports;
          lastError = undefined;
          requestSucceeded = true;
          break;
        } catch (error) {
          lastError = error;
          await delay(1_500);
        }
      }

      if (!requestSucceeded) {
        break;
      }
    }

    if (!lastSignature || remainingLamports > 0) {
      const reason = lastError instanceof Error ? lastError.message : "unknown error";
      throw new Error(`airdrop to ${input.recipient.toBase58()} failed: ${reason}`);
    }

    return {
      signature: lastSignature,
      source: "airdrop"
    };
  }
}

function loadTreasuryWalletFromEnv(): WalletManager | null {
  const secretKey = getOptionalDevnetTreasurySecretKey();
  if (!secretKey) {
    return null;
  }

  return WalletManager.fromSecretKey(secretKey, "env");
}

function roundSolAmount(amountSol: number): number {
  return Math.max(0, Math.round(amountSol * LAMPORTS_PER_SOL) / LAMPORTS_PER_SOL);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
