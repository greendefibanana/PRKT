import { PolicyGuard } from "../policy/PolicyGuard";
import { KoraSigner, type GaslessExecutionResult } from "../kora/KoraSigner";
import { WalletManager } from "../wallet/WalletManager";
import { MockPriceFeed, type MarketSnapshot } from "./MockPriceFeed";
import { SwapExecutor, type LiveSwapResult } from "../dex/SwapExecutor";
import type { GuardedPreparedTransactionExecutor } from "../defi/universal";
import { RpcClient } from "../core/rpc/RpcClient";
import { PostTransactionVerifier } from "../core/transactions/PostTransactionVerifier";
import { TokenService } from "../core/tokens/TokenService";
import { getRpcUrl } from "../config/env";
import { PublicKey } from "@solana/web3.js";

export type TradeSimulationResult = {
  action: "execute_swap" | "hold";
  execution: GaslessExecutionResult | null;
  liveSwap: LiveSwapResult | null;
  market: MarketSnapshot;
  memo: string | null;
};

export type RuntimeLogger = (message: string) => void;

export async function simulateMarketAction(input: {
  amountSol: number;
  koraSigner: KoraSigner;
  liveSwapConfig?: {
    guardedExecutor?: GuardedPreparedTransactionExecutor;
    enabled: boolean;
    outputMint: string;
    swapExecutor: SwapExecutor | null;
  };
  logger?: RuntimeLogger;
  policyGuard: PolicyGuard;
  priceFeed: MockPriceFeed;
  walletManager: WalletManager;
}): Promise<TradeSimulationResult> {
  const market = input.priceFeed.read();
  const logger = input.logger ?? (() => undefined);

  if (market.solPriceUsd > market.buyThresholdUsd) {
    logger(`Decision -> HOLD (SOL @ $${market.solPriceUsd.toFixed(2)} exceeds threshold $${market.buyThresholdUsd.toFixed(2)})`);
    return {
      action: "hold",
      execution: null,
      liveSwap: null,
      market,
      memo: null
    };
  }

  if (input.liveSwapConfig?.enabled && input.liveSwapConfig.swapExecutor) {
    if (input.liveSwapConfig.guardedExecutor) {
      logger("Decision -> Policy Check -> Guarded Live Jupiter Swap.");

      const rpcClient = new RpcClient(getRpcUrl(), "confirmed");
      const tokenService = new TokenService(rpcClient);
      const verifier = new PostTransactionVerifier(rpcClient, tokenService);
      const outputBalanceSnapshot = await verifier.snapshotSplBalanceForOwner({
        label: `Jupiter output token balance (${input.liveSwapConfig.outputMint})`,
        mint: new PublicKey(input.liveSwapConfig.outputMint),
        owner: input.walletManager.publicKey
      });
      const preparedSwap = await input.liveSwapConfig.swapExecutor.buildSolToTokenSwapTransaction({
        amountSol: input.amountSol,
        outputMint: input.liveSwapConfig.outputMint,
        walletManager: input.walletManager
      });
      const guardedExecution = await input.liveSwapConfig.guardedExecutor.executePreparedTransaction({
        transaction: preparedSwap.transaction
      });

      if (guardedExecution.signature) {
        const [verification] = await verifier.assertBalanceChanges([
          {
            minIncreaseRaw: 1n,
            snapshot: outputBalanceSnapshot
          }
        ]);
        logger(
          `Verified ${guardedExecution.signature}: ${verification.label} ${verification.beforeUi} -> ${verification.afterUi} (${verification.deltaUi})`
        );
        logger(`Executed live swap ${guardedExecution.signature}`);
        return {
          action: "execute_swap",
          execution: {
            endpoint: "guarded-solana-rpc",
            memo: `JUPITER_SWAP:${input.amountSol.toFixed(2)} SOL->${input.liveSwapConfig.outputMint}`,
            mock: false,
            signature: guardedExecution.signature
          },
          liveSwap: {
            execution: {
              endpoint: "guarded-solana-rpc",
              memo: `JUPITER_SWAP:${input.amountSol.toFixed(2)} SOL->${input.liveSwapConfig.outputMint}`,
              mock: false,
              signature: guardedExecution.signature
            },
            outputMint: preparedSwap.outputMint,
            quoteOutAmount: preparedSwap.quoteOutAmount,
            routeType: preparedSwap.routeType
          },
          market,
          memo: null
        };
      }

      logger(
        `Guarded live swap blocked${guardedExecution.inspection.reasons.length > 0 ? `: ${guardedExecution.inspection.reasons.join("; ")}` : ""}. Falling back to memo execution.`
      );
    } else {
      logger("Guarded live swap executor missing. Falling back to memo execution.");
    }
  }

  const memo = `SWAP_INTENT:${input.amountSol.toFixed(2)} SOL->USDC @ $${market.solPriceUsd.toFixed(2)}`;
  logger("Decision -> Policy Check -> Gasless Execution.");

  const transaction = await input.koraSigner.buildMemoTransaction(input.walletManager, memo);
  input.policyGuard.validate(transaction);

  const execution = await input.koraSigner.signAndSendGasless(transaction, memo);
  logger(`Executed ${execution.mock ? "mock " : ""}gasless swap intent ${execution.signature}`);

  return {
    action: "execute_swap",
    execution,
    liveSwap: null,
    market,
    memo
  };
}
