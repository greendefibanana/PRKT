export const REQUIRED_STARTING_SOL = 0.12;
export const MAX_STARTING_WSOL_FOR_WRAP_DEMO = 0.0099;

export function assertDeterministicWrapPreflight(input: {
  maxStartingWsol?: number;
  requiredStartingSol?: number;
  startingSolBalance: number;
  startingWsolBalance: number;
}): void {
  const requiredStartingSol = input.requiredStartingSol ?? REQUIRED_STARTING_SOL;
  const maxStartingWsol = input.maxStartingWsol ?? MAX_STARTING_WSOL_FOR_WRAP_DEMO;

  if (input.startingSolBalance < requiredStartingSol) {
    throw new Error(
      `Preflight failed: wallet has ${input.startingSolBalance.toFixed(4)} SOL. Fund at least ${requiredStartingSol.toFixed(
        2
      )} SOL on devnet before running wallet:devnet.`
    );
  }

  if (input.startingWsolBalance > maxStartingWsol) {
    throw new Error(
      `Preflight failed: wallet already has ${input.startingWsolBalance.toFixed(
        4
      )} wSOL. For a deterministic wrap demo, reduce wSOL below ${maxStartingWsol.toFixed(
        4
      )} and rerun.`
    );
  }
}
