import { TransactionMessage } from "@solana/web3.js";

import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "../../src/solana/programs";
import { TokenWallet } from "../../src/spl/TokenWallet";
import { WalletManager } from "../../src/wallet/WalletManager";

describe("TokenWallet", () => {
  it("derives a deterministic associated token address for the wallet", () => {
    const wallet = WalletManager.generate();

    const first = TokenWallet.findAssociatedTokenAddress(wallet.publicKey, NATIVE_MINT);
    const second = TokenWallet.findAssociatedTokenAddress(wallet.publicKey, NATIVE_MINT);

    expect(first.toBase58()).toBe(second.toBase58());
  });

  it("builds a signed wrap SOL transaction with token instructions", async () => {
    const wallet = WalletManager.generate();
    const result = await TokenWallet.buildWrapSolTransaction({
      amountLamports: 1_000_000,
      createAssociatedTokenAccount: true,
      recentBlockhash: "11111111111111111111111111111111",
      walletManager: wallet
    });

    const decompiled = TransactionMessage.decompile(result.transaction.message);
    const programIds = decompiled.instructions.map((instruction) => instruction.programId.toBase58());

    expect(result.transaction.signatures[0]).toBeDefined();
    expect(programIds).toContain(TOKEN_PROGRAM_ID.toBase58());
    expect(result.associatedTokenAddress.toBase58()).toBeTruthy();
  });
});
