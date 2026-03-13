import { PolicyGuard } from "../policy/PolicyGuard";
import type { PolicyConstraints } from "../types/policy";
import { KoraSigner } from "../kora/KoraSigner";
import { WalletManager } from "../wallet/WalletManager";
import { DeFiPolicyGuard } from "./DeFiPolicyGuard";
import type { DeFiExecutionResult, DeFiIntent } from "./types";

export class DeFiExecutor {
  private readonly defiPolicyGuard: DeFiPolicyGuard;
  private readonly policyGuard: PolicyGuard;

  constructor(private readonly policy: PolicyConstraints) {
    this.defiPolicyGuard = new DeFiPolicyGuard(policy);
    this.policyGuard = new PolicyGuard(policy);
  }

  async executeIntent(input: {
    intent: DeFiIntent;
    koraSigner: KoraSigner;
    walletManager: WalletManager;
  }): Promise<DeFiExecutionResult> {
    this.defiPolicyGuard.validateIntent(input.intent);

    const transaction = await input.koraSigner.buildMemoTransaction(
      input.walletManager,
      input.intent.memo
    );
    this.policyGuard.validate(transaction);

    const execution = await input.koraSigner.signAndSendGasless(transaction, input.intent.memo);

    return {
      action: input.intent.action,
      memo: input.intent.memo,
      mock: execution.mock,
      protocol: input.intent.protocol,
      signature: execution.signature
    };
  }
}
