import { assertDeterministicWrapPreflight } from "../../src/scripts/devnetWalletPreflight";

describe("devnet wallet preflight", () => {
  it("accepts balances that satisfy the deterministic wrap requirements", () => {
    expect(() =>
      assertDeterministicWrapPreflight({
        startingSolBalance: 0.2,
        startingWsolBalance: 0
      })
    ).not.toThrow();
  });

  it("fails when SOL balance is below the required minimum", () => {
    expect(() =>
      assertDeterministicWrapPreflight({
        startingSolBalance: 0.05,
        startingWsolBalance: 0
      })
    ).toThrow("Fund at least");
  });

  it("fails when wSOL balance makes the wrap demo non-deterministic", () => {
    expect(() =>
      assertDeterministicWrapPreflight({
        startingSolBalance: 0.2,
        startingWsolBalance: 0.02
      })
    ).toThrow("reduce wSOL below");
  });
});
