import * as sdk from "../../src/index";

describe("SDK entrypoint", () => {
  it("exports the expected public surface without executing runtime side effects", () => {
    expect(typeof sdk.WalletManager).toBe("function");
    expect(typeof sdk.PolicyEngine).toBe("function");
    expect(typeof sdk.AgentRunner).toBe("function");
    expect(typeof sdk.SessionAnchor).toBe("function");
    expect(typeof sdk.ProofAnchor).toBe("function");
    expect(typeof sdk.UniversalDeFiOrchestrator).toBe("function");
    expect(typeof sdk.defaultPRKTConfig).toBe("object");
    expect(typeof sdk.getRpcUrl).toBe("function");
  });
});
