import { createDefaultAgentPolicy } from "../../src/agent/policyFactory";
import { DeFiPolicyGuard } from "../../src/defi/DeFiPolicyGuard";
import { SecurityViolationError } from "../../src/policy/errors";

describe("DeFiPolicyGuard", () => {
  it("allows approved protocol intents within configured limits", () => {
    const guard = new DeFiPolicyGuard(createDefaultAgentPolicy());

    expect(() =>
      guard.validateIntent({
        action: "stake",
        amountLamports: 500_000,
        marketId: "primary-stake-pool",
        memo: "DEFI_INTENT:MARINADE:stake",
        protocol: "marinade",
        slippageBps: 25
      })
    ).not.toThrow();
  });

  it("blocks intents that exceed protocol exposure limits", () => {
    const guard = new DeFiPolicyGuard(createDefaultAgentPolicy());

    expect(() =>
      guard.validateIntent({
        action: "add_liquidity",
        amountLamports: 1_200_000_000,
        marketId: "sol-usdc-core-pool",
        memo: "DEFI_INTENT:RAYDIUM:add_liquidity",
        protocol: "raydium",
        slippageBps: 80
      })
    ).toThrow(SecurityViolationError);
  });

  it("blocks lending intents with unsafe health factors", () => {
    const guard = new DeFiPolicyGuard(createDefaultAgentPolicy());

    expect(() =>
      guard.validateIntent({
        action: "deposit",
        amountLamports: 500_000,
        expectedHealthFactor: 1.1,
        marketId: "main-usdc-vault",
        memo: "DEFI_INTENT:KAMINO:deposit",
        protocol: "kamino",
        slippageBps: 40
      })
    ).toThrow("health factor");
  });

  it("blocks borrow intents with unsafe health factors", () => {
    const guard = new DeFiPolicyGuard(createDefaultAgentPolicy());

    expect(() =>
      guard.validateIntent({
        action: "borrow",
        amountLamports: 500_000,
        expectedHealthFactor: 1.2,
        marketId: "main-usdc-vault",
        memo: "DEFI_INTENT:KAMINO:borrow",
        protocol: "kamino",
        slippageBps: 40
      })
    ).toThrow("health factor");
  });
});
