import type { PolicyConstraints } from "../types/policy";
import { SecurityViolationError } from "../policy/errors";
import type { DeFiIntent } from "./types";

export class DeFiPolicyGuard {
  constructor(private readonly policy: PolicyConstraints) {}

  validateIntent(intent: DeFiIntent): void {
    const protocolPolicy = this.policy.protocolPolicies[intent.protocol];
    if (!protocolPolicy || !protocolPolicy.enabled) {
      throw new SecurityViolationError(`Protocol blocked: ${intent.protocol} is disabled.`);
    }

    if (!protocolPolicy.allowedMarkets.includes(intent.marketId)) {
      throw new SecurityViolationError(
        `Protocol blocked: market ${intent.marketId} is not approved for ${intent.protocol}.`
      );
    }

    if (intent.amountLamports > protocolPolicy.maxExposureLamports) {
      throw new SecurityViolationError(
        `Protocol blocked: amount ${intent.amountLamports} exceeds protocol exposure ${protocolPolicy.maxExposureLamports}.`
      );
    }

    if (intent.slippageBps > protocolPolicy.maxSlippageBps) {
      throw new SecurityViolationError(
        `Protocol blocked: slippage ${intent.slippageBps} exceeds max ${protocolPolicy.maxSlippageBps}.`
      );
    }

    if (
      protocolPolicy.minHealthFactor !== undefined &&
      intent.expectedHealthFactor !== undefined &&
      intent.expectedHealthFactor < protocolPolicy.minHealthFactor
    ) {
      throw new SecurityViolationError(
        `Protocol blocked: health factor ${intent.expectedHealthFactor.toFixed(2)} is below minimum ${protocolPolicy.minHealthFactor.toFixed(2)}.`
      );
    }
  }
}
