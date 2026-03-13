import { Percentage, ReadOnlyWallet, TransactionBuilder } from "@orca-so/common-sdk";
import {
  PDAUtil,
  TickUtil,
  TokenExtensionUtil,
  WhirlpoolContext,
  buildWhirlpoolClient,
  increaseLiquidityQuoteByInputTokenUsingPriceDeviation
} from "@orca-so/whirlpools-sdk";
import {
  getAssociatedTokenAddressSync,
  NATIVE_MINT as SPL_NATIVE_MINT
} from "@solana/spl-token";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import Decimal from "decimal.js";

import { createDefaultPolicyConfig } from "../config/agentPolicies";
import { detectClusterFromRpcUrl, getRpcUrl } from "../config/env";
import { BalanceService } from "../core/balances/BalanceService";
import { DevnetFundingService } from "../core/funding/DevnetFundingService";
import { RpcClient } from "../core/rpc/RpcClient";
import { TokenService } from "../core/tokens/TokenService";
import { TransactionService } from "../core/transactions/TransactionService";
import { PolicyEngine, SandboxExecutor } from "../policy";
import type { WalletManager } from "../wallet/WalletManager";
import {
  ensureManagedAgentWalletFunding,
  getManagedAgentName,
  getManagedOwnerId,
  logManagedAgentWallet,
  resolveManagedAgentWallet
} from "./managedAgentWallet";
import { printDemoMode } from "./mode";

const DEFAULT_AGENT_NAME = "orca-live-devnet";
const DEFAULT_LP_SOL = 0.05;
const MINIMUM_SOL_BALANCE = 0.25;
const ORCA_DEVNET_PROGRAM_ID = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
const ORCA_DEVNET_CONFIG = new PublicKey("FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR");
const ORCA_DEVNET_CONFIG_EXTENSION = new PublicKey(
  "475EJ7JqnRpVLoFVzp2ruEYvWWMCf6Z8KMWRujtXXNSU"
);
const ORCA_DEVNET_USDC_MINT = new PublicKey("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k");
const ORCA_DEVNET_TICK_SPACING = 64;

async function main(): Promise<void> {
  const depositAmountSol = parseAmountSol(process.argv[2]);
  printDemoMode(
    "LIVE",
    `Orca Whirlpool LP demo on devnet (${depositAmountSol.toFixed(4)} SOL one-sided deposit)`
  );

  const rpcUrl = getRpcUrl();
  const cluster = detectClusterFromRpcUrl(rpcUrl);
  if (cluster !== "devnet") {
    throw new Error(`Orca LP demo requires devnet. Current RPC cluster is ${cluster} (${rpcUrl}).`);
  }

  const rpcClient = new RpcClient(rpcUrl, "confirmed");
  const tokenService = new TokenService(rpcClient);
  const balanceService = new BalanceService(rpcClient, tokenService);
  const transactionService = new TransactionService(rpcClient);
  const fundingService = new DevnetFundingService(rpcClient, transactionService);
  const managed = resolveManagedAgentWallet({
    agentName: getManagedAgentName({
      defaultAgentName: DEFAULT_AGENT_NAME,
      env: process.env
    }),
    ownerId: getManagedOwnerId(process.env)
  });
  const walletManager = managed.walletManager;

  console.log("PRKT Orca devnet LP demo");
  console.log(`RPC: ${rpcUrl}`);
  logManagedAgentWallet(managed);
  console.log(`Orca program: ${ORCA_DEVNET_PROGRAM_ID.toBase58()}`);
  console.log(`Orca config: ${ORCA_DEVNET_CONFIG.toBase58()}`);
  console.log(`Orca config extension: ${ORCA_DEVNET_CONFIG_EXTENSION.toBase58()}`);

  await ensureManagedAgentWalletFunding({
    balanceService,
    fundingService,
    minimumSol: MINIMUM_SOL_BALANCE,
    publicKey: walletManager.publicKey
  });

  const orcaWallet = new ReadOnlyWallet(walletManager.publicKey);
  const whirlpoolContext = WhirlpoolContext.from(rpcClient.connection, orcaWallet);
  const whirlpoolClient = buildWhirlpoolClient(whirlpoolContext);
  const whirlpool = await loadSupportedDevnetPool(whirlpoolClient);
  const poolData = whirlpool.getData();
  const poolAddress = whirlpool.getAddress();
  const tokenA = whirlpool.getTokenAInfo();
  const tokenB = whirlpool.getTokenBInfo();

  if (TickUtil.isFullRangeOnly(poolData.tickSpacing)) {
    throw new Error(
      `Configured Orca pool ${poolAddress.toBase58()} is full-range only (tick spacing ${poolData.tickSpacing}).`
    );
  }

  const { sideDescription, tickLowerIndex, tickUpperIndex } = deriveOneSidedPositionRange({
    currentTickIndex: poolData.tickCurrentIndex,
    nativeIsTokenA: tokenA.mint.equals(SPL_NATIVE_MINT),
    tickSpacing: poolData.tickSpacing
  });
  const tokenExtensionContext = await TokenExtensionUtil.buildTokenExtensionContextForPool(
    whirlpoolClient.getFetcher(),
    tokenA.mint,
    tokenB.mint
  );
  const quote = increaseLiquidityQuoteByInputTokenUsingPriceDeviation(
    SPL_NATIVE_MINT,
    new Decimal(depositAmountSol.toString()),
    tickLowerIndex,
    tickUpperIndex,
    Percentage.fromFraction(1, 100),
    whirlpool,
    tokenExtensionContext
  );

  if (quote.liquidityAmount.isZero()) {
    throw new Error(
      `Orca quote returned zero liquidity for pool ${poolAddress.toBase58()}. Try a different amount or RPC.`
    );
  }

  const policyEngine = new PolicyEngine(
    createDefaultPolicyConfig({
      agentId: managed.agent.name,
      allowOpaqueProgramIds: [ORCA_DEVNET_PROGRAM_ID.toBase58()],
      allowedCloseAccountDestinations: [walletManager.publicKey.toBase58()],
      approvalMode: "sandbox",
      extraAllowedProgramIds: [ORCA_DEVNET_PROGRAM_ID.toBase58()]
    })
  );
  const sandboxExecutor = new SandboxExecutor(policyEngine, transactionService, "sandbox");

  console.log(`Pool: ${poolAddress.toBase58()}`);
  console.log(`Pool tick spacing: ${poolData.tickSpacing}`);
  console.log(`Pool token A: ${tokenA.mint.toBase58()}`);
  console.log(`Pool token B: ${tokenB.mint.toBase58()}`);
  console.log(`Current tick: ${poolData.tickCurrentIndex}`);
  console.log(`Range: [${tickLowerIndex}, ${tickUpperIndex}] (${sideDescription})`);
  console.log(`Estimated token max A: ${quote.tokenMaxA.toString()}`);
  console.log(`Estimated token max B: ${quote.tokenMaxB.toString()}`);

  const initTickArrays = await whirlpool.initTickArrayForTicks(
    [tickLowerIndex, tickUpperIndex],
    walletManager.publicKey
  );
  if (initTickArrays && !initTickArrays.isEmpty()) {
    const tickArraySignature = await executeBuilder({
      builder: initTickArrays,
      label: "initialize Orca tick arrays",
      sandboxExecutor,
      walletManager
    });
    console.log(`Tick array init signature: ${tickArraySignature}`);
  }

  const { positionMint, tx } = await whirlpool.openPosition(
    tickLowerIndex,
    tickUpperIndex,
    quote,
    walletManager.publicKey,
    walletManager.publicKey
  );
  const lpSignature = await executeBuilder({
    builder: tx,
    label: "open Orca position",
    sandboxExecutor,
    walletManager
  });
  const positionTokenAccount = getAssociatedTokenAddressSync(positionMint, walletManager.publicKey);
  const positionTokenBalance = await readPositionTokenBalance(positionTokenAccount, rpcClient);
  if (positionTokenBalance !== 1n) {
    throw new Error(
      `Orca position verification failed: expected 1 position token, got ${positionTokenBalance.toString()}.`
    );
  }

  const solAfter = await balanceService.getSolBalance(walletManager.publicKey);
  console.log(`Position mint: ${positionMint.toBase58()}`);
  console.log(`Position token account: ${positionTokenAccount.toBase58()}`);
  console.log(`Transaction signature: ${lpSignature}`);
  console.log(`SOL after execution: ${solAfter.toFixed(4)}`);
}

async function loadSupportedDevnetPool(
  whirlpoolClient: ReturnType<typeof buildWhirlpoolClient>
): Promise<Awaited<ReturnType<ReturnType<typeof buildWhirlpoolClient>["getPool"]>>> {
  const candidates = [
    PDAUtil.getWhirlpool(
      ORCA_DEVNET_PROGRAM_ID,
      ORCA_DEVNET_CONFIG,
      SPL_NATIVE_MINT,
      ORCA_DEVNET_USDC_MINT,
      ORCA_DEVNET_TICK_SPACING
    ).publicKey,
    PDAUtil.getWhirlpool(
      ORCA_DEVNET_PROGRAM_ID,
      ORCA_DEVNET_CONFIG,
      ORCA_DEVNET_USDC_MINT,
      SPL_NATIVE_MINT,
      ORCA_DEVNET_TICK_SPACING
    ).publicKey
  ];

  for (const address of candidates) {
    try {
      return await whirlpoolClient.getPool(address);
    } catch {
      continue;
    }
  }

  throw new Error(
    `Could not load the public Orca devnet SOL/devUSDC concentrated pool (tick spacing ${ORCA_DEVNET_TICK_SPACING}).`
  );
}

function deriveOneSidedPositionRange(input: {
  currentTickIndex: number;
  nativeIsTokenA: boolean;
  tickSpacing: number;
}): {
  sideDescription: string;
  tickLowerIndex: number;
  tickUpperIndex: number;
} {
  const [minTick, maxTick] = TickUtil.getFullRangeTickIndex(input.tickSpacing);
  const currentTickIndex = TickUtil.getInitializableTickIndex(
    input.currentTickIndex,
    input.tickSpacing
  );
  const width = input.tickSpacing * 128;
  const gap = input.tickSpacing * 64;

  if (input.nativeIsTokenA) {
    const tickLowerIndex = Math.min(
      Math.max(currentTickIndex + gap, minTick),
      maxTick - width
    );
    return {
      sideDescription: "one-sided SOL above current price",
      tickLowerIndex,
      tickUpperIndex: tickLowerIndex + width
    };
  }

  const tickUpperIndex = Math.max(
    Math.min(currentTickIndex - gap, maxTick),
    minTick + width
  );
  return {
    sideDescription: "one-sided SOL below current price",
    tickLowerIndex: tickUpperIndex - width,
    tickUpperIndex
  };
}

async function executeBuilder(input: {
  builder: TransactionBuilder;
  label: string;
  sandboxExecutor: SandboxExecutor;
  walletManager: WalletManager;
}): Promise<string> {
  const payload = await input.builder.build({
    maxSupportedTransactionVersion: 0
  });
  if (!(payload.transaction instanceof VersionedTransaction)) {
    throw new Error(`${input.label} did not build a versioned transaction.`);
  }

  if (payload.signers.length > 0) {
    payload.transaction.sign(payload.signers);
  }

  const signedTransaction = await input.walletManager.signTransaction(payload.transaction);
  const execution = await input.sandboxExecutor.executePreparedTransaction({
    confirmationStrategy: {
      blockhash: payload.recentBlockhash.blockhash,
      lastValidBlockHeight: payload.recentBlockhash.lastValidBlockHeight,
      signature: ""
    },
    transaction: signedTransaction
  });
  if (!execution.signature) {
    throw new Error(
      `${input.label} was blocked: ${execution.inspection.reasons.join("; ") || "unknown reason"}`
    );
  }

  return execution.signature;
}

async function readPositionTokenBalance(
  tokenAccount: PublicKey,
  rpcClient: RpcClient
): Promise<bigint> {
  const accountInfo = await rpcClient.getAccountInfo(tokenAccount, "confirmed");
  if (!accountInfo) {
    return 0n;
  }

  const balance = await rpcClient.getTokenAccountBalance(tokenAccount, "confirmed");
  return BigInt(balance.value.amount);
}

function parseAmountSol(rawValue: string | undefined): number {
  if (!rawValue) {
    return DEFAULT_LP_SOL;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid SOL amount '${rawValue}'. Provide a positive decimal SOL amount.`);
  }

  return parsed;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Orca LP devnet demo failed: ${message}`);
  process.exitCode = 1;
});
