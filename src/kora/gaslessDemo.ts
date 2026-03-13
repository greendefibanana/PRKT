export function assertGaslessDemoReadiness(input: {
  solLamports: number;
  usdcBalance: number;
}): void {
  if (input.solLamports !== 0) {
    throw new Error(
      "wallet:gasless requires the agent wallet to start with exactly 0 SOL so the fee abstraction claim is unambiguous."
    );
  }

  if (input.usdcBalance < 1) {
    throw new Error("wallet:gasless requires at least 1.0 USDC in the agent wallet.");
  }
}

export function parseUiAmount(input: {
  amount: string;
  decimals: number;
  uiAmount: number | null;
}): number {
  if (input.uiAmount !== null) {
    return input.uiAmount;
  }

  return Number(input.amount) / 10 ** input.decimals;
}
