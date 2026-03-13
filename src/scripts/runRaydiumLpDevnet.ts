import { Connection, PublicKey } from "@solana/web3.js";

import { createDefaultPolicyConfig } from "../config/agentPolicies";
import { getRpcUrl } from "../config/env";
import { RpcClient } from "../core/rpc/RpcClient";
import { PostTransactionVerifier } from "../core/transactions/PostTransactionVerifier";
import { TransactionService } from "../core/transactions/TransactionService";
import { TokenService } from "../core/tokens/TokenService";
import { RaydiumAdapter } from "../defi/adapters/RaydiumAdapter";
import { loadRaydiumLpDevnetConfig } from "../defi/lp/raydiumDevnetConfig";
import { PolicyEngine, SandboxExecutor } from "../policy";
import { WalletManager } from "../wallet/WalletManager";
import { printDemoMode } from "./mode";

async function main(): Promise<void> {
  printDemoMode("LIVE", "Real Raydium add-liquidity transaction on configured cluster");

  const walletManager = WalletManager.loadOrGenerate();
  const connection = new Connection(getRpcUrl(), "confirmed");
  const rpcClient = new RpcClient(getRpcUrl(), "confirmed");
  const tokenService = new TokenService(rpcClient);
  const verifier = new PostTransactionVerifier(rpcClient, tokenService);
  const transactionService = new TransactionService(rpcClient);
  const config = loadRaydiumLpDevnetConfig();
  const adapter = new RaydiumAdapter();

  const requiredAccounts = [
    config.poolConfig.poolId,
    config.poolConfig.authority,
    config.poolConfig.baseVault,
    config.poolConfig.quoteVault,
    config.poolConfig.openOrders,
    config.poolConfig.targetOrders,
    config.poolConfig.marketId,
    config.poolConfig.marketEventQueue,
    config.poolConfig.lpMint,
    config.userTokenAccounts.baseTokenAccount,
    config.userTokenAccounts.quoteTokenAccount,
    config.userTokenAccounts.lpTokenAccount
  ];

  const accountInfos = await connection.getMultipleAccountsInfo(
    requiredAccounts.map((key) => new PublicKey(key)),
    "confirmed"
  );

  const missingAccounts = requiredAccounts.filter((_, index) => accountInfos[index] === null);
  if (missingAccounts.length > 0) {
    throw new Error(
      `The following configured accounts do not exist on the selected cluster: ${missingAccounts.join(", ")}`
    );
  }

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const lpBalanceSnapshot = await verifier.snapshotSplTokenAccount({
    label: "Raydium LP token balance",
    mint: new PublicKey(config.poolConfig.lpMint),
    tokenAccount: new PublicKey(config.userTokenAccounts.lpTokenAccount)
  });
  const transaction = await adapter.buildAddLiquidityTransactionDraft({
    baseAmountIn: config.amounts.baseAmountIn,
    otherAmountMin: config.amounts.otherAmountMin,
    owner: walletManager,
    poolConfig: config.poolConfig,
    quoteAmountIn: config.amounts.quoteAmountIn,
    recentBlockhash: latestBlockhash.blockhash,
    userTokenAccounts: config.userTokenAccounts
  });

  const policyEngine = new PolicyEngine(
    createDefaultPolicyConfig({
      allowOpaqueProgramIds: [config.poolConfig.programId],
      agentId: "raydium-live-devnet-script",
      approvalMode: "sandbox",
      extraAllowedProgramIds: [config.poolConfig.programId]
    })
  );
  const sandboxExecutor = new SandboxExecutor(
    policyEngine,
    transactionService,
    "sandbox"
  );

  console.log("PRKT Raydium devnet LP demo");
  console.log(`Wallet: ${walletManager.publicKey.toBase58()}`);
  console.log(`Pool: ${config.poolConfig.poolId}`);
  console.log(`Base amount in: ${config.amounts.baseAmountIn}`);
  console.log(`Quote amount in: ${config.amounts.quoteAmountIn}`);

  const execution = await sandboxExecutor.executePreparedTransaction({
    confirmationStrategy: {
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      signature: ""
    },
    transaction
  });
  if (!execution.signature) {
    throw new Error(
      `Guarded Raydium execution blocked: ${execution.inspection.reasons.join("; ") || "unknown reason"}`
    );
  }

  const [verification] = await verifier.assertBalanceChanges([
    {
      minIncreaseRaw: 1n,
      snapshot: lpBalanceSnapshot
    }
  ]);

  console.log(`Transaction signature: ${execution.signature}`);
  console.log(
    `Verification: ${verification.label} ${verification.beforeUi} -> ${verification.afterUi} (${verification.deltaUi})`
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Raydium LP devnet demo failed: ${message}`);
  process.exitCode = 1;
});
