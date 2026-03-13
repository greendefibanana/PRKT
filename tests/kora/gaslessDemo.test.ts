import { assertGaslessDemoReadiness, parseUiAmount } from "../../src/kora/gaslessDemo";

describe("gaslessDemo helpers", () => {
  it("rejects wallets that are pre-funded with SOL", () => {
    expect(() =>
      assertGaslessDemoReadiness({
        solLamports: 1,
        usdcBalance: 1
      })
    ).toThrow("exactly 0 SOL");
  });

  it("rejects wallets without enough USDC", () => {
    expect(() =>
      assertGaslessDemoReadiness({
        solLamports: 0,
        usdcBalance: 0.99
      })
    ).toThrow("at least 1.0 USDC");
  });

  it("prefers uiAmount when it is available", () => {
    expect(
      parseUiAmount({
        amount: "1000000",
        decimals: 6,
        uiAmount: 1
      })
    ).toBe(1);
  });

  it("falls back to raw amount and decimals when uiAmount is null", () => {
    expect(
      parseUiAmount({
        amount: "1000000",
        decimals: 6,
        uiAmount: null
      })
    ).toBe(1);
  });
});
