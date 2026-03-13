import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { MemoHeartbeatStrategy } from "../../agent/strategies/MemoHeartbeatStrategy";
import { SimpleScriptedTransferStrategy } from "../../agent/strategies/SimpleScriptedTransferStrategy";
import { UniversalDeFiStrategy } from "../../agent/strategies/UniversalDeFiStrategy";
import type { Strategy } from "../../agent/types/AgentContext";

export function createStrategy(input: {
  name: string;
  config?: Record<string, unknown>;
}): Strategy {
  const name = input.name.trim().toLowerCase();
  if (name === "memo-heartbeat") {
    return new MemoHeartbeatStrategy();
  }

  if (name === "simple-scripted-transfer") {
    const to = typeof input.config?.to === "string" ? input.config.to : undefined;
    const amountSol =
      typeof input.config?.amountSol === "number" ? input.config.amountSol : 0.001;
    if (!to) {
      throw new Error("simple-scripted-transfer requires strategy config key 'to'.");
    }
    return new SimpleScriptedTransferStrategy({
      to,
      lamports: Math.round(amountSol * LAMPORTS_PER_SOL),
      memo:
        typeof input.config?.memo === "string"
          ? input.config.memo
          : "cli simple-scripted-transfer"
    });
  }

  if (name === "universal-defi") {
    return new UniversalDeFiStrategy([
      {
        capability: "trade",
        snapshot: {
          buyThresholdUsd: 100,
          solPriceUsd: 95
        }
      },
      {
        capability: "staking",
        snapshot: {
          idleSolLamports: Math.round(1 * LAMPORTS_PER_SOL)
        }
      },
      {
        capability: "lp",
        snapshot: {
          liquidityInRange: true
        }
      },
      {
        capability: "lending",
        snapshot: {
          healthFactor: 2.1,
          idleUsdcAtomic: 5_000_000
        }
      },
      {
        capability: "borrowing",
        snapshot: {
          borrowDemandUsdcAtomic: 3_000_000,
          collateralSolLamports: Math.round(1 * LAMPORTS_PER_SOL),
          healthFactor: 2.3
        }
      }
    ]);
  }

  throw new Error(
    `Unknown strategy '${input.name}'. Supported: memo-heartbeat, simple-scripted-transfer, universal-defi.`
  );
}
