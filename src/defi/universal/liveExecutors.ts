import {
  address,
  createNoopSigner
} from "@solana/kit";
import { BN, Marinade, MarinadeConfig } from "@marinade.finance/marinade-ts-sdk";
import {
  KaminoAction,
  VanillaObligation
} from "@kamino-finance/klend-sdk";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction
} from "@solana/web3.js";

import {
  detectClusterFromRpcUrl,
  getJupiterApiBaseUrl,
  getKaminoLiveConfigPath,
  getRpcUrl,
  getUsdcMintAddress,
  isLiveKaminoEnabled,
  isLiveMarinadeEnabled,
  isLiveRaydiumLpEnabled,
  isLiveSwapPathEnabled
} from "../../config/env";
import { RpcClient } from "../../core/rpc/RpcClient";
import { PostTransactionVerifier } from "../../core/transactions/PostTransactionVerifier";
import { TokenService } from "../../core/tokens/TokenService";
import { JupiterSwapClient } from "../../dex/JupiterSwapClient";
import { SwapExecutor } from "../../dex/SwapExecutor";
import { loadRaydiumLpDevnetConfig } from "../lp/raydiumDevnetConfig";
import { RaydiumAdapter } from "../adapters/RaydiumAdapter";
import { convertKaminoInstruction } from "../kamino/kaminoInstructionCompat";
import { loadKaminoLiveConfig } from "../kamino/kaminoLiveConfig";
import { loadKaminoMarketWithFallback } from "../kamino/loadKaminoMarketWithFallback";
import type { DeFiExecutionResult, DeFiIntent } from "../types";
import type { WalletManager } from "../../wallet/WalletManager";
import type { PreparedLiveExecution } from "./types";

export async function prepareLiveJupiter(input: {
  intent: DeFiIntent;
  logger?: (message: string) => void;
  walletManager: WalletManager;
}): Promise<PreparedLiveExecution | null> {
  if (input.intent.protocol !== "jupiter" || input.intent.action !== "trade") {
    return null;
  }

  if (!isLiveSwapPathEnabled()) {
    input.logger?.("live jupiter disabled via ENABLE_LIVE_SWAP_PATH");
    return null;
  }

  const amountSol = input.intent.amountLamports / LAMPORTS_PER_SOL;
  const outputMint = getUsdcMintAddress();
  const rpcClient = new RpcClient(getRpcUrl(), "confirmed");
  const tokenService = new TokenService(rpcClient);
  const verifier = new PostTransactionVerifier(rpcClient, tokenService);
  const outputSnapshot = await verifier.snapshotSplBalanceForOwner({
    label: `Jupiter output token balance (${outputMint})`,
    mint: new PublicKey(outputMint),
    owner: input.walletManager.publicKey
  });
  const swapExecutor = new SwapExecutor(new JupiterSwapClient(getJupiterApiBaseUrl()));
  const prepared = await swapExecutor.buildSolToTokenSwapTransaction({
    amountSol,
    outputMint,
    slippageBps: input.intent.slippageBps,
    walletManager: input.walletManager
  });

  return {
    protocol: input.intent.protocol,
    toExecutionResult(signature: string): DeFiExecutionResult {
      return {
        action: input.intent.action,
        memo: `LIVE:JUPITER:${input.intent.marketId}:${input.intent.amountLamports}`,
        mock: false,
        protocol: input.intent.protocol,
        signature
      };
    },
    transaction: prepared.transaction,
    async verifyExecution(signature: string): Promise<void> {
      const [report] = await verifier.assertBalanceChanges([
        {
          minIncreaseRaw: 1n,
          snapshot: outputSnapshot
        }
      ]);
      input.logger?.(
        `verified ${signature}: ${report.label} ${report.beforeUi} -> ${report.afterUi} (${report.deltaUi})`
      );
    }
  };
}

export async function prepareLiveRaydiumLp(input: {
  intent: DeFiIntent;
  logger?: (message: string) => void;
  walletManager: WalletManager;
}): Promise<PreparedLiveExecution | null> {
  if (input.intent.protocol !== "raydium" || input.intent.action !== "add_liquidity") {
    return null;
  }

  if (!isLiveRaydiumLpEnabled()) {
    input.logger?.("live raydium disabled via ENABLE_LIVE_RAYDIUM_LP");
    return null;
  }

  const rpcUrl = getRpcUrl();
  const cluster = detectClusterFromRpcUrl(rpcUrl);
  if (cluster !== "devnet" && cluster !== "unknown") {
    input.logger?.(`live raydium lp currently intended for devnet; current cluster=${cluster}`);
    return null;
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const rpcClient = new RpcClient(rpcUrl, "confirmed");
  const tokenService = new TokenService(rpcClient);
  const verifier = new PostTransactionVerifier(rpcClient, tokenService);
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
  const missing = requiredAccounts.filter((_, index) => accountInfos[index] === null);
  if (missing.length > 0) {
    input.logger?.(`live raydium config invalid on cluster; missing ${missing.length} accounts`);
    return null;
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
    owner: input.walletManager,
    poolConfig: config.poolConfig,
    quoteAmountIn: config.amounts.quoteAmountIn,
    recentBlockhash: latestBlockhash.blockhash,
    userTokenAccounts: config.userTokenAccounts
  });

  return {
    confirmationStrategy: {
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      signature: ""
    },
    protocol: input.intent.protocol,
    policyConfigPatch: {
      rules: {
        allowOpaqueProgramIds: [config.poolConfig.programId],
        allowedProgramIds: [config.poolConfig.programId]
      }
    },
    toExecutionResult(signature: string): DeFiExecutionResult {
      return {
        action: input.intent.action,
        memo: `LIVE:RAYDIUM:${config.poolConfig.poolId}`,
        mock: false,
        protocol: input.intent.protocol,
        signature
      };
    },
    transaction,
    async verifyExecution(signature: string): Promise<void> {
      const [report] = await verifier.assertBalanceChanges([
        {
          minIncreaseRaw: 1n,
          snapshot: lpBalanceSnapshot
        }
      ]);
      input.logger?.(
        `verified ${signature}: ${report.label} ${report.beforeUi} -> ${report.afterUi} (${report.deltaUi})`
      );
    }
  };
}

export async function prepareLiveKamino(input: {
  intent: DeFiIntent;
  logger?: (message: string) => void;
  walletManager: WalletManager;
}): Promise<PreparedLiveExecution | null> {
  if (
    input.intent.protocol !== "kamino" ||
    (input.intent.action !== "deposit" && input.intent.action !== "borrow")
  ) {
    return null;
  }

  if (!isLiveKaminoEnabled()) {
    input.logger?.("live kamino disabled via ENABLE_LIVE_KAMINO");
    return null;
  }

  const rpcUrl = getRpcUrl();
  const cluster = detectClusterFromRpcUrl(rpcUrl);
  const config = loadKaminoLiveConfig();
  if (config.cluster && cluster !== "unknown" && cluster !== config.cluster) {
    throw new Error(
      `Kamino live config cluster=${config.cluster} does not match current RPC cluster=${cluster}. Check ${getKaminoLiveConfigPath()}.`
    );
  }

  const rpcClient = new RpcClient(rpcUrl, "confirmed");
  const tokenService = new TokenService(rpcClient);
  const verifier = new PostTransactionVerifier(rpcClient, tokenService);
  const connection = new Connection(rpcUrl, "confirmed");
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const configuredMarketAddress = new PublicKey(config.marketAddress);
  const configuredProgramId = new PublicKey(config.programId);
  const marketAccount = await rpcClient.getAccountInfo(configuredMarketAddress, "confirmed");
  if (!marketAccount) {
    throw new Error(
      `Kamino market ${config.marketAddress} does not exist on ${rpcUrl}. Update ${getKaminoLiveConfigPath()} with a valid market address for this cluster.`
    );
  }
  if (!marketAccount.owner.equals(configuredProgramId)) {
    throw new Error(
      `Kamino market ${config.marketAddress} is owned by ${marketAccount.owner.toBase58()}, not Kamino program ${config.programId}. Update ${getKaminoLiveConfigPath()} with a valid market address for this cluster.`
    );
  }
  const ownerAddress = address(input.walletManager.publicKey.toBase58());
  const ownerSigner = createNoopSigner(ownerAddress);
  const programAddress = address(config.programId);
  const marketAddress = address(config.marketAddress);
  const obligationType = new VanillaObligation(programAddress);
  const market = await loadKaminoMarketWithFallback({
    cluster,
    logger: input.logger,
    marketAddress,
    programAddress,
    rpcUrl
  });

  if (input.intent.action === "deposit") {
    const depositMint = address(config.depositMint);
    market.getExistingReserveByMint(depositMint, "configured deposit mint");
    const beforeDeposit = await market.getObligationDepositByWallet(
      ownerAddress,
      depositMint,
      obligationType
    );
    const action = await KaminoAction.buildDepositTxns(
      market,
      config.actions.depositAmountRaw.toString(),
      depositMint,
      ownerSigner,
      obligationType,
      true,
      undefined,
      0,
      true,
      false,
      {
        skipInitialization: false,
        skipLutCreation: true
      }
    );

    return {
      confirmationStrategy: {
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        signature: ""
      },
      protocol: input.intent.protocol,
      policyConfigPatch: {
        rules: {
          allowedCloseAccountDestinations: [input.walletManager.publicKey.toBase58()],
          allowOpaqueProgramIds: [config.programId],
          allowedProgramIds: [config.programId]
        }
      },
      toExecutionResult(signature: string): DeFiExecutionResult {
        return {
          action: input.intent.action,
          memo: `LIVE:KAMINO:deposit:${config.marketAddress}:${config.depositMint}`,
          mock: false,
          protocol: input.intent.protocol,
          signature
        };
      },
      transaction: await buildSignedVersionedTransaction({
        instructions: buildKaminoInstructions(action, cluster, input.logger),
        payer: input.walletManager.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        walletManager: input.walletManager
      }),
      async verifyExecution(signature: string): Promise<void> {
        const afterDeposit = await market.getObligationDepositByWallet(
          ownerAddress,
          depositMint,
          obligationType
        );
        if (!afterDeposit.greaterThan(beforeDeposit)) {
          throw new Error(
            `Kamino deposit verification failed: obligation deposit did not increase (${beforeDeposit.toString()} -> ${afterDeposit.toString()}).`
          );
        }

        input.logger?.(
          `verified ${signature}: Kamino obligation deposit ${beforeDeposit.toString()} -> ${afterDeposit.toString()} (${afterDeposit.minus(beforeDeposit).toString()})`
        );
      }
    };
  }

  const borrowMint = address(config.borrowMint);
  market.getExistingReserveByMint(borrowMint, "configured borrow mint");
  const beforeBorrow = await market.getObligationBorrowByWallet(ownerAddress, borrowMint, obligationType);
  const borrowSnapshot = await verifier.snapshotSplBalanceForOwner({
    label: `Kamino borrowed token balance (${config.borrowMint})`,
    mint: new PublicKey(config.borrowMint),
    owner: input.walletManager.publicKey
  });
  const action = await KaminoAction.buildBorrowTxns(
    market,
    config.actions.borrowAmountRaw.toString(),
    borrowMint,
    ownerSigner,
    obligationType,
    true,
    undefined,
    0,
    true,
    false,
    {
      skipInitialization: false,
      skipLutCreation: true
    }
  );

  return {
    confirmationStrategy: {
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      signature: ""
    },
    protocol: input.intent.protocol,
    policyConfigPatch: {
      rules: {
        allowedCloseAccountDestinations: [input.walletManager.publicKey.toBase58()],
        allowOpaqueProgramIds: [config.programId],
        allowedProgramIds: [config.programId]
      }
    },
    toExecutionResult(signature: string): DeFiExecutionResult {
      return {
        action: input.intent.action,
        memo: `LIVE:KAMINO:borrow:${config.marketAddress}:${config.borrowMint}`,
        mock: false,
        protocol: input.intent.protocol,
        signature
      };
    },
      transaction: await buildSignedVersionedTransaction({
        instructions: buildKaminoInstructions(action, cluster, input.logger),
        payer: input.walletManager.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        walletManager: input.walletManager
      }),
    async verifyExecution(signature: string): Promise<void> {
      const afterBorrow = await market.getObligationBorrowByWallet(ownerAddress, borrowMint, obligationType);
      if (!afterBorrow.greaterThan(beforeBorrow)) {
        throw new Error(
          `Kamino borrow verification failed: obligation borrow did not increase (${beforeBorrow.toString()} -> ${afterBorrow.toString()}).`
        );
      }

      const [report] = await verifier.assertBalanceChanges([
        {
          minIncreaseRaw: 1n,
          snapshot: borrowSnapshot
        }
      ]);
      input.logger?.(
        `verified ${signature}: ${report.label} ${report.beforeUi} -> ${report.afterUi} (${report.deltaUi}); obligation borrow ${beforeBorrow.toString()} -> ${afterBorrow.toString()}`
      );
    }
  };
}

export async function prepareLiveMarinade(input: {
  intent: DeFiIntent;
  logger?: (message: string) => void;
  walletManager: WalletManager;
}): Promise<PreparedLiveExecution | null> {
  if (input.intent.protocol !== "marinade" || input.intent.action !== "stake") {
    return null;
  }

  if (!isLiveMarinadeEnabled()) {
    input.logger?.("live marinade disabled via ENABLE_LIVE_MARINADE");
    return null;
  }

  const rpcUrl = getRpcUrl();
  const cluster = detectClusterFromRpcUrl(rpcUrl);
  if (cluster !== "devnet" && cluster !== "unknown") {
    input.logger?.(`live marinade staking currently intended for devnet; current cluster=${cluster}`);
    return null;
  }

  const rpcClient = new RpcClient(rpcUrl, "confirmed");
  const tokenService = new TokenService(rpcClient);
  const verifier = new PostTransactionVerifier(rpcClient, tokenService);
  const connection = new Connection(rpcUrl, "confirmed");
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const marinade = new Marinade(
    new MarinadeConfig({
      connection,
      publicKey: input.walletManager.publicKey
    })
  );
  const marinadeState = await marinade.getMarinadeState();
  const msolSnapshot = await verifier.snapshotSplBalanceForOwner({
    label: `Marinade mSOL balance (${marinadeState.mSolMintAddress.toBase58()})`,
    mint: marinadeState.mSolMintAddress,
    owner: input.walletManager.publicKey
  });
  const prepared = await marinade.deposit(new BN(input.intent.amountLamports));

  return {
    confirmationStrategy: {
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      signature: ""
    },
    protocol: input.intent.protocol,
    policyConfigPatch: {
      rules: {
        allowOpaqueProgramIds: [marinade.config.marinadeFinanceProgramId.toBase58()],
        allowedProgramIds: [marinade.config.marinadeFinanceProgramId.toBase58()]
      }
    },
    toExecutionResult(signature: string): DeFiExecutionResult {
      return {
        action: input.intent.action,
        memo: `LIVE:MARINADE:stake:${input.intent.amountLamports}`,
        mock: false,
        protocol: input.intent.protocol,
        signature
      };
    },
    transaction: await buildSignedVersionedTransaction({
      instructions: prepared.transaction.instructions,
      payer: input.walletManager.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      walletManager: input.walletManager
    }),
    async verifyExecution(signature: string): Promise<void> {
      const [report] = await verifier.assertBalanceChanges([
        {
          minIncreaseRaw: 1n,
          snapshot: msolSnapshot
        }
      ]);
      input.logger?.(
        `verified ${signature}: ${report.label} ${report.beforeUi} -> ${report.afterUi} (${report.deltaUi})`
      );
    }
  };
}

function buildVersionedTransaction(input: {
  instructions: TransactionInstruction[];
  payer: PublicKey;
  recentBlockhash: string;
}): VersionedTransaction {
  const message = new TransactionMessage({
    instructions: input.instructions,
    payerKey: input.payer,
    recentBlockhash: input.recentBlockhash
  }).compileToV0Message();

  return new VersionedTransaction(message);
}

async function buildSignedVersionedTransaction(input: {
  instructions: TransactionInstruction[];
  payer: PublicKey;
  recentBlockhash: string;
  walletManager: WalletManager;
}): Promise<VersionedTransaction> {
  const transaction = buildVersionedTransaction(input);
  return input.walletManager.signTransaction(transaction);
}

function buildKaminoInstructions(
  action: KaminoAction,
  cluster: ReturnType<typeof detectClusterFromRpcUrl>,
  logger?: (message: string) => void
): TransactionInstruction[] {
  const instructions = KaminoAction.actionToIxs(action);
  const labels = KaminoAction.actionToIxLabels(action);

  if (cluster !== "devnet") {
    return instructions.map(convertKaminoInstruction);
  }

  const filtered = instructions.filter((_, index) => !labels[index]?.startsWith("RefreshReserve["));
  if (filtered.length !== instructions.length) {
    logger?.(`kamino devnet compatibility removed ${instructions.length - filtered.length} RefreshReserve instructions`);
  }

  return filtered.map(convertKaminoInstruction);
}
