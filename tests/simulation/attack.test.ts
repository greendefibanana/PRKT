import { PolicyGuard } from "../../src/policy/PolicyGuard";
import { SecurityViolationError } from "../../src/policy/errors";
import { createDefaultAgentPolicy } from "../../src/agent/policyFactory";
import { simulateAttack } from "../../src/simulation/attack";
import { WalletManager } from "../../src/wallet/WalletManager";

describe("simulateAttack", () => {
  it("throws a security violation for a drain attempt", () => {
    const walletManager = WalletManager.generate();
    const policyGuard = new PolicyGuard(
      createDefaultAgentPolicy({
        whitelistedTransferDestinations: []
      })
    );

    expect(() => simulateAttack(policyGuard, walletManager)).toThrow(SecurityViolationError);
  });
});
