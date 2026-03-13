import { Percentage, ReadOnlyWallet, TransactionBuilder } from "@orca-so/common-sdk";
import {
  PDAUtil,
  TickUtil,
  TokenExtensionUtil,
  WhirlpoolContext,
  buildWhirlpoolClient,
  increaseLiquidityQuoteByInputTokenUsingPriceDeviation
} from "@orca-so/whirlpools-sdk";
import { getAssociatedTokenAddressSync, NATIVE_MINT as SPL_NATIVE_MINT } from "@solana/spl-token";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import Decimal from "decimal.js";

import { MockPriceFeed } from "../agent/MockPriceFeed";
import { simulateMarketAction } from "../agent/AgentRuntime";
import { createDefaultAgentPolicy } from "../agent/policyFactory";
import { createDefaultPolicyConfig } from "../config/agentPolicies";
import {
  detectClusterFromRpcUrl,
  getRpcUrl,
  getUsdcMintAddress
} from "../config/env";
import { BalanceService } from "../core/balances/BalanceService";
import { DevnetFundingService } from "../core/funding/DevnetFundingService";
import { RpcClient } from "../core/rpc/RpcClient";
import { TokenService } from "../core/tokens/TokenService";
import { TransactionService } from "../core/transactions/TransactionService";
import { DeFiExecutor } from "../defi/DeFiExecutor";
import { loadKaminoLiveConfig } from "../defi/kamino/kaminoLiveConfig";
import { PROTOCOL_PRESETS } from "../defi/protocols";
import {
  prepareLiveKamino
} from "../defi/universal/liveExecutors";
import type { PreparedLiveExecution } from "../defi/universal";
import { PolicyGuard } from "../policy/PolicyGuard";
import { PolicyEngine, SandboxExecutor } from "../policy";
import type { WalletManager } from "../wallet/WalletManager";
import { createKoraSigner } from "./shared";
import {
  ensureManagedAgentWalletFunding,
  getManagedAgentName,
  getManagedOwnerId,
  logManagedAgentWallet,
  resolveManagedAgentWallet
} from "./managedAgentWallet";
import { printDemoMode } from "./mode";

const DEFAULT_AGENT_NAME = "autonomous-portfolio-devnet";
const REQUIRED_FUNDING_SOL = 0.4;
const DEFAULT_SWAP_SOL = 0.01;
const DEFAULT_ORCA_LP_SOL = 0.05;
const ORCA_DEVNET_PROGRAM_ID = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
const ORCA_DEVNET_CONFIG = new PublicKey("FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR");
const ORCA_DEVNET_USDC_MINT = new PublicKey("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k");
const ORCA_DEVNET_TICK_SPACING = 64;

async function main(): Promise<void> {
  printDemoMode(
    "LIVE",
    "Autonomous portfolio wallet: provision or load the assigned agent wallet, fund on devnet, swap via Jupiter, open Orca LP, then attempt Kamino deposit/borrow live with simulated fallback on devnet"
  );

  const rpcUrl = getRpcUrl();
  const cluster = detectClusterFromRpcUrl(rpcUrl);
  if (cluster !== "devnet") {
    throw new Error(`Autonomous portfolio demo requires devnet. Current RPC cluster is ${cluster} (${rpcUrl}).`);
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

  console.log("PRKT autonomous portfolio demo");
  console.log(`RPC: ${rpcUrl}`);
  logManagedAgentWallet(managed);

  await ensureManagedAgentWalletFunding({
    balanceService,
    fundingService,
    minimumSol: REQUIRED_FUNDING_SOL,
    publicKey: walletManager.publicKey
  });

  const signatures: Array<{ label: string; signature: string }> = [];

  const swapResult = await executeAutonomousSwapIntent({
    amountSol: DEFAULT_SWAP_SOL,
    walletManager
  });
  signatures.push({
    label:
      swapResult.mode === "LIVE"
        ? "Jupiter swap"
        : "Jupiter swap intent (simulated on devnet)",
    signature: swapResult.signature
  });

  const orcaResult = await executeAutonomousOrcaLp({
    balanceService,
    depositAmountSol: DEFAULT_ORCA_LP_SOL,
    rpcClient,
    tokenService,
    transactionService,
    walletManager
  });
  if (orcaResult.tickArrayInitSignature) {
    signatures.push({
      label: "Orca tick arrays",
      signature: orcaResult.tickArrayInitSignature
    });
  }
  signatures.push({
    label: "Orca LP position",
    signature: orcaResult.signature
  });

  const kaminoDepositResult = await executeKaminoActionWithFallback({
    action: "deposit",
    transactionService,
    walletManager
  });
  signatures.push({
    label: kaminoDepositResult.label,
    signature: kaminoDepositResult.signature
  });

  const kaminoBorrowResult = await executeKaminoActionWithFallback({
    action: "borrow",
    transactionService,
    walletManager
  });
  signatures.push({
    label: kaminoBorrowResult.label,
    signature: kaminoBorrowResult.signature
  });

  const usdcMint = new PublicKey(getUsdcMintAddress());
  const solAfter = await balanceService.getSolBalance(walletManager.publicKey);
  const usdcAfter = await balanceService.getSplTokenBalance({
    mint: usdcMint,
    owner: walletManager.publicKey
  });

  console.log("");
  console.log("Autonomous portfolio run");
  for (const entry of signatures) {
    console.log(`${entry.label}: ${entry.signature}`);
  }
  console.log(`Orca position mint: ${orcaResult.positionMint}`);
  console.log(`SOL after: ${solAfter.toFixed(4)}`);
  console.log(`USDC after: ${usdcAfter.toFixed(6)}`);
}

async function executeAutonomousSwapIntent(input: {
  amountSol: number;
  walletManager: WalletManager;
}): Promise<{ mode: "LIVE" | "SIMULATED"; signature: string }> {
  const result = await simulateMarketAction({
    amountSol: input.amountSol,
    koraSigner: createKoraSigner(),
    liveSwapConfig: {
      enabled: false,
      outputMint: getUsdcMintAddress(),
      swapExecutor: null
    },
    logger: (message) => console.log(`[autonomous-jupiter] ${message}`),
    policyGuard: new PolicyGuard(createDefaultAgentPolicy()),
    priceFeed: new MockPriceFeed({
      buyThresholdUsd: 100,
      solPriceUsd: 95,
      usdcPriceUsd: 1
    }),
    walletManager: input.walletManager
  });
  if (!result.execution) {
    throw new Error("Autonomous Jupiter swap intent did not produce an execution result.");
  }

  return {
    mode: result.liveSwap && !result.execution.mock ? "LIVE" : "SIMULATED",
    signature: result.execution.signature
  };
}

async function executeLiveKaminoAction(input: {
  action: "borrow" | "deposit";
  transactionService: TransactionService;
  walletManager: WalletManager;
}): Promise<string> {
  const config = loadKaminoLiveConfig();
  const prepared = await prepareLiveKamino({
    intent: {
      action: input.action,
      amountLamports: 0,
      marketId: PROTOCOL_PRESETS.kamino.defaultMarketId,
      memo: `LIVE:KAMINO:${input.action}`,
      protocol: "kamino",
      slippageBps: 40
    },
    logger: (message) => console.log(`[autonomous-kamino] ${message}`),
    walletManager: input.walletManager
  });
  if (!prepared) {
    throw new Error(
      `Kamino ${input.action} was not prepared. Check ENABLE_LIVE_KAMINO and ${config.marketAddress}.`
    );
  }

  return executePreparedLive({
    agentId: `autonomous-portfolio-kamino-${input.action}`,
    prepared,
    transactionService: input.transactionService
  });
}

async function executeKaminoActionWithFallback(input: {
  action: "borrow" | "deposit";
  transactionService: TransactionService;
  walletManager: WalletManager;
}): Promise<{ label: string; signature: string }> {
  try {
    const signature = await executeLiveKaminoAction(input);
    return {
      label: `Kamino ${input.action}`,
      signature
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown Kamino live error";
    console.log(
      `[autonomous-kamino] live ${input.action} failed on devnet (${summarizeKaminoLiveFailure(
        message
      )}); falling back to simulated intent`
    );

    const signature = await executeSimulatedKaminoAction(input);
    return {
      label: `Kamino ${input.action} intent (simulated fallback)`,
      signature
    };
  }
}

async function executeSimulatedKaminoAction(input: {
  action: "borrow" | "deposit";
  walletManager: WalletManager;
}): Promise<string> {
  const executor = new DeFiExecutor(
    createDefaultAgentPolicy({
      maxSpend: {
        lamports: 1_000_000_000
      }
    })
  );
  const result = await executor.executeIntent({
    intent: {
      action: input.action,
      amountLamports: 0,
      expectedHealthFactor: input.action === "borrow" ? 2.2 : 2.0,
      marketId: PROTOCOL_PRESETS.kamino.defaultMarketId,
      memo: `DEFI_INTENT:KAMINO:${input.action}:DEVNET_FALLBACK`,
      protocol: "kamino",
      slippageBps: 40
    },
    koraSigner: createKoraSigner(),
    walletManager: input.walletManager
  });

  return result.signature;
}

function summarizeKaminoLiveFailure(message: string): string {
  if (message.includes("ReserveStale")) {
    return "reserve refresh is currently broken on the selected devnet market";
  }

  if (message.includes("InvalidOracleConfig")) {
    return "the selected devnet market has invalid oracle configuration";
  }

  if (message.includes("simulation failed")) {
    return "transaction simulation failed";
  }

  return message.length > 140 ? `${message.slice(0, 137)}...` : message;
}

async function executePreparedLive(input: {
  agentId: string;
  prepared: PreparedLiveExecution;
  transactionService: TransactionService;
}): Promise<string> {
  const policyEngine = new PolicyEngine(
    createDefaultPolicyConfig({
      agentId: input.agentId,
      allowOpaqueProgramIds: input.prepared.policyConfigPatch?.rules?.allowOpaqueProgramIds,
      allowedCloseAccountDestinations:
        input.prepared.policyConfigPatch?.rules?.allowedCloseAccountDestinations,
      approvalMode: "sandbox",
      extraAllowedProgramIds: input.prepared.policyConfigPatch?.rules?.allowedProgramIds
    })
  );
  const sandboxExecutor = new SandboxExecutor(policyEngine, input.transactionService, "sandbox");
  const execution = await sandboxExecutor.executePreparedTransaction({
    confirmationStrategy: input.prepared.confirmationStrategy,
    inspectionContext: input.prepared.inspectionContext,
    transaction: input.prepared.transaction
  });
  if (!execution.signature) {
    const simulationLogs = execution.simulationLogs?.join(" | ");
    throw new Error(
      `Guarded ${input.prepared.protocol} execution blocked: ${
        execution.inspection.reasons.join("; ") || "unknown reason"
      }${simulationLogs ? ` | simulation logs: ${simulationLogs}` : ""}`
    );
  }

  if (input.prepared.verifyExecution) {
    await input.prepared.verifyExecution(execution.signature);
  }

  return execution.signature;
}

async function executeAutonomousOrcaLp(input: {
  balanceService: BalanceService;
  depositAmountSol: number;
  rpcClient: RpcClient;
  tokenService: TokenService;
  transactionService: TransactionService;
  walletManager: WalletManager;
}): Promise<{
  positionMint: string;
  signature: string;
  tickArrayInitSignature?: string;
}> {
  const orcaWallet = new ReadOnlyWallet(input.walletManager.publicKey);
  const whirlpoolContext = WhirlpoolContext.from(input.rpcClient.connection, orcaWallet);
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
    new Decimal(input.depositAmountSol.toString()),
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
      agentId: "autonomous-portfolio-orca",
      allowOpaqueProgramIds: [ORCA_DEVNET_PROGRAM_ID.toBase58()],
      allowedCloseAccountDestinations: [input.walletManager.publicKey.toBase58()],
      approvalMode: "sandbox",
      extraAllowedProgramIds: [ORCA_DEVNET_PROGRAM_ID.toBase58()]
    })
  );
  const sandboxExecutor = new SandboxExecutor(policyEngine, input.transactionService, "sandbox");
  const solBefore = await input.balanceService.getSolBalance(input.walletManager.publicKey);

  console.log(`Orca pool: ${poolAddress.toBase58()}`);
  console.log(`Orca range: [${tickLowerIndex}, ${tickUpperIndex}] (${sideDescription})`);
  console.log(`Orca estimated token max A: ${quote.tokenMaxA.toString()}`);
  console.log(`Orca estimated token max B: ${quote.tokenMaxB.toString()}`);

  let tickArrayInitSignature: string | undefined;
  const initTickArrays = await whirlpool.initTickArrayForTicks(
    [tickLowerIndex, tickUpperIndex],
    input.walletManager.publicKey
  );
  if (initTickArrays && !initTickArrays.isEmpty()) {
    tickArrayInitSignature = await executeBuilder({
      builder: initTickArrays,
      label: "initialize Orca tick arrays",
      sandboxExecutor,
      walletManager: input.walletManager
    });
  }

  const { positionMint, tx } = await whirlpool.openPosition(
    tickLowerIndex,
    tickUpperIndex,
    quote,
    input.walletManager.publicKey,
    input.walletManager.publicKey
  );
  const positionTokenAccount = getAssociatedTokenAddressSync(
    positionMint,
    input.walletManager.publicKey
  );
  const signature = await executeBuilder({
    builder: tx,
    label: "open Orca position",
    sandboxExecutor,
    walletManager: input.walletManager
  });
  const positionTokenBalance = await readPositionTokenBalance(positionTokenAccount, input.rpcClient);
  if (positionTokenBalance !== 1n) {
    throw new Error(
      `Orca position verification failed: expected 1 position token, got ${positionTokenBalance.toString()}.`
    );
  }
  const solAfter = await input.balanceService.getSolBalance(input.walletManager.publicKey);
  console.log(`Orca verified ${signature}: position token balance ${positionTokenBalance.toString()}`);
  console.log(`Orca SOL before: ${solBefore.toFixed(4)}`);
  console.log(`Orca SOL after: ${solAfter.toFixed(4)}`);

  return {
    positionMint: positionMint.toBase58(),
    signature,
    tickArrayInitSignature
  };
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

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Autonomous portfolio demo failed: ${message}`);
  process.exitCode = 1;
});
