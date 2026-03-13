import { summarizeKaminoFailure } from "../../src/scripts/runKaminoDevnet";

describe("runKaminoDevnet", () => {
  it("normalizes ReserveStale failures into a devnet-specific summary", () => {
    expect(summarizeKaminoFailure("simulation failed: ReserveStale")).toBe(
      "reserve refresh is currently broken on the selected devnet market"
    );
  });

  it("normalizes InvalidOracleConfig failures into a devnet-specific summary", () => {
    expect(summarizeKaminoFailure("simulation failed: InvalidOracleConfig")).toBe(
      "the selected devnet market has invalid oracle configuration"
    );
  });

  it("returns the raw reason when it is not a known Kamino devnet issue", () => {
    expect(summarizeKaminoFailure("custom failure")).toBe("custom failure");
  });
});
