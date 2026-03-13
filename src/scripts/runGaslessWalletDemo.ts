import { Connection, PublicKey } from "@solana/web3.js";

import {
  assertMintMatchesRpcCluster,
  getRpcUrl,
  getUsdcMintAddress,
  isKoraMockMode
} from "../config/env";
import { assertGaslessDemoReadiness, parseUiAmount } from "../kora/gaslessDemo";
import { TokenWallet } from "../spl/TokenWallet";
import {
  getManagedAgentName,
  getManagedOwnerId,
  logManagedAgentWallet,
  resolveManagedAgentWallet
} from "./managedAgentWallet";
import { createKoraSigner } from "./shared";
import { printDemoMode } from "./mode";

const DEFAULT_AGENT_NAME = "gasless-wallet-demo";

async function main(): Promise<void> {
  const rpcUrl = getRpcUrl();
  const usdcMintAddress = getUsdcMintAddress();
  assertMintMatchesRpcCluster({
    mintAddress: usdcMintAddress,
    mintName: "USDC_MINT",
    rpcUrl
  });

  const connection = new Connection(rpcUrl, "confirmed");
  const managed = resolveManagedAgentWallet({
    agentName: getManagedAgentName({ defaultAgentName: DEFAULT_AGENT_NAME, env: process.env }),
    ownerId: getManagedOwnerId(process.env)
  });
  const walletManager = managed.walletManager;
  const koraSigner = createKoraSigner();
  const usdcMint = new PublicKey(usdcMintAddress);
  const usdcAccount = TokenWallet.findAssociatedTokenAddress(walletManager.publicKey, usdcMint);

  const solLamports = await connection.getBalance(walletManager.publicKey, "confirmed");
  const usdcAccountInfo = await connection.getAccountInfo(usdcAccount, "confirmed");
  let usdcBalance = 0;

  if (usdcAccountInfo) {
    const tokenBalance = await connection.getTokenAccountBalance(usdcAccount, "confirmed");
    usdcBalance = parseUiAmount(tokenBalance.value);
  }

  console.log("PRKT gasless wallet demo");
  logManagedAgentWallet(managed);
  console.log(`USDC ATA: ${usdcAccount.toBase58()}`);
  console.log(`Starting SOL balance (lamports): ${solLamports}`);
  console.log(`Starting USDC balance: ${usdcBalance.toFixed(6)}`);

  assertGaslessDemoReadiness({
    solLamports,
    usdcBalance
  });

  if (isKoraMockMode()) {
    console.log(
      "KORA_MOCK_MODE=true. The script will show the same fee-abstraction flow, but the signature is simulated."
    );
  }

  const result = await koraSigner.submitGaslessMemo(
    walletManager,
    "PRKT gasless agent check (USDC-backed fee abstraction)"
  );
  const modeLabel = result.fallbackReason
    ? "mock-fallback"
    : result.mock
      ? "mock"
      : "live";
  printDemoMode(result.mock ? "SIMULATED" : "LIVE", "Gasless memo transport");
  const endingSolLamports = await connection.getBalance(walletManager.publicKey, "confirmed");

  console.log("Gasless execution complete.");
  console.log(`Signature: ${result.signature}`);
  console.log(`Mode: ${modeLabel}`);
  if (result.fallbackReason) {
    console.log(`Fallback reason: ${result.fallbackReason}`);
  }
  console.log(`Ending SOL balance (lamports): ${endingSolLamports}`);
  console.log(
    "Kora relayed the transaction while the wallet started at 0 SOL. For this demo, the relayer is expected to be configured to settle fees against the wallet's USDC liquidity."
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Gasless wallet demo failed: ${message}`);
  process.exitCode = 1;
});
