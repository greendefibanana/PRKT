import { Connection } from "@solana/web3.js";

import { getRpcUrl } from "../config/env";
import { WalletManager } from "../wallet/WalletManager";

async function main(): Promise<void> {
  const rpcUrl = getRpcUrl();
  const connection = new Connection(rpcUrl, "confirmed");
  const walletManager = WalletManager.loadOrGenerate();

  const { publicKey, source } = walletManager.toSafeSummary();

  console.log("PRKT wallet ready.");
  console.log(`RPC: ${rpcUrl}`);
  console.log(`Wallet source: ${source}`);
  console.log(`Devnet public key: ${publicKey}`);

  const balanceLamports = await connection.getBalance(walletManager.publicKey);
  console.log(`Devnet balance (lamports): ${balanceLamports}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Startup failed: ${message}`);
  process.exitCode = 1;
});
