import {
  assertMintMatchesRpcCluster,
  getJupiterApiBaseUrl,
  getRpcUrl,
  getUsdcMintAddress,
  isLiveSwapPathEnabled
} from "../config/env";
import { JupiterSwapClient } from "../dex/JupiterSwapClient";
import { SwapExecutor } from "../dex/SwapExecutor";
import type { GuardedPreparedTransactionExecutor } from "../defi/universal";

export function createLiveSwapConfig(): {
  guardedExecutor?: GuardedPreparedTransactionExecutor;
  enabled: boolean;
  outputMint: string;
  swapExecutor: SwapExecutor | null;
} {
  const enabled = isLiveSwapPathEnabled();
  const outputMint = getUsdcMintAddress();
  assertMintMatchesRpcCluster({
    mintAddress: outputMint,
    mintName: "USDC_MINT",
    rpcUrl: getRpcUrl()
  });

  if (!enabled) {
    return {
      enabled,
      outputMint,
      swapExecutor: null
    };
  }

  return {
    enabled,
    outputMint,
    swapExecutor: new SwapExecutor(new JupiterSwapClient(getJupiterApiBaseUrl()))
  };
}
