import { Connection } from "@solana/web3.js";

import { DecisionEngine } from "../agent/DecisionEngine";
import { getRpcUrl } from "../config/env";
import { NATIVE_MINT } from "../solana/programs";
import { TokenWallet } from "../spl/TokenWallet";
import { WalletManager } from "../wallet/WalletManager";
import { printDemoMode } from "./mode";
import { assertDeterministicWrapPreflight } from "./devnetWalletPreflight";

async function main(): Promise<void> {
  printDemoMode("LIVE", "Direct Solana transaction path (wrap SOL into wSOL)");

  const rpcUrl = getRpcUrl();
  const connection = new Connection(rpcUrl, "confirmed");
  const walletManager = WalletManager.loadConfigured();
  const associatedTokenAddress = TokenWallet.findAssociatedTokenAddress(
    walletManager.publicKey,
    NATIVE_MINT
  );

  console.log("PRKT devnet wallet demo");
  console.log(`RPC: ${rpcUrl}`);
  console.log(`Wallet: ${walletManager.publicKey.toBase58()}`);

  const startingSolBalance = (await connection.getBalance(walletManager.publicKey, "confirmed")) / 1_000_000_000;
  let startingWsolBalance = 0;
  const existingWsolAccount = await connection.getAccountInfo(associatedTokenAddress, "confirmed");
  if (existingWsolAccount) {
    const tokenBalance = await connection.getTokenAccountBalance(associatedTokenAddress, "confirmed");
    startingWsolBalance = tokenBalance.value.uiAmount ?? 0;
  }

  assertDeterministicWrapPreflight({
    startingSolBalance,
    startingWsolBalance
  });

  const agent = new DecisionEngine(connection, walletManager);
  const result = await agent.think();

  console.log(`Associated token account: ${associatedTokenAddress.toBase58()}`);
  console.log(`Decision: ${result.action}`);

  if (result.action !== "wrap") {
    throw new Error(
      "Execution failed: DecisionEngine returned HOLD during a deterministic wrap run. Check preflight balances and retry."
    );
  }

  const endingWsolBalance = result.wsolBalance;
  if (endingWsolBalance <= startingWsolBalance) {
    throw new Error(
      `Post-check failed: wSOL did not increase (${startingWsolBalance.toFixed(4)} -> ${endingWsolBalance.toFixed(4)}).`
    );
  }

  console.log(`Created ATA this run: ${result.createdAssociatedTokenAccount ? "yes" : "no"}`);
  console.log(`Wrapped amount: ${result.wrapAmount.toFixed(2)} SOL`);
  console.log(`Transaction signature: ${result.signature}`);
  console.log(`wSOL before: ${startingWsolBalance.toFixed(4)}`);
  console.log(`wSOL after: ${endingWsolBalance.toFixed(4)}`);
  console.log("Post-check passed: wSOL balance increased.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Devnet wallet demo failed: ${message}`);
  process.exitCode = 1;
});
