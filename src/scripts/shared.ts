import {
  getJupiterApiBaseUrl,
  getKoraRpcUrl,
  getRpcUrl,
  isKoraMockMode,
  isLiveSwapPathEnabled
} from "../config/env";
import { KoraRpcClient } from "../kora/KoraRpcClient";
import { KoraSigner } from "../kora/KoraSigner";

export function createRuntimeLogger(prefix: string): (message: string) => void {
  return (message: string) => {
    console.log(`[${prefix}] ${message}`);
  };
}

export function createKoraSigner(): KoraSigner {
  const koraRpcUrl = getKoraRpcUrl();
  const mockMode = isKoraMockMode();

  console.log(`[runtime] Solana RPC: ${getRpcUrl()}`);
  console.log(`[runtime] Kora RPC: ${koraRpcUrl}`);
  console.log(`[runtime] Kora mock mode: ${mockMode}`);
  console.log(`[runtime] Live swap path: ${isLiveSwapPathEnabled()}`);
  console.log(`[runtime] Jupiter API: ${getJupiterApiBaseUrl()}`);

  return new KoraSigner(new KoraRpcClient(koraRpcUrl), {
    fallbackToMockOnError: true,
    mockMode
  });
}
