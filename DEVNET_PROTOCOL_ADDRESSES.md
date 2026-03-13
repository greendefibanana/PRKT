# Devnet Protocol Addresses

This file records the devnet protocol values that were verified or inferred for the current repo.

## Kamino

Current devnet values from Kamino's public API / official SDK surface:

- Program ID: `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`
- Primary market from Kamino public API: `ARVAgHAZiNGCbZ8Cb4BitwZoNQ8eBWsk7ZeinPgmNjgi`

Repo test config written to `kamino_live.json`:

- `programId`: `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`
- `marketAddress`: `HqCoqWT42Qdg1fbsWFo6TNCkH6eSY2MtxHFEkPoBvCHm`
- `depositMint`: `So11111111111111111111111111111111111111112`
- `borrowMint`: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`

Notes:

- `programId` and the primary devnet market were verified from Kamino's public market API for `env=devnet`.
- The repo points `kamino_live.json` at `HqCo...` because that market exposes canonical `So111...` and devnet USDC mints, which lets the autonomous wallet attempt a real Kamino deposit/borrow path on a generated wallet.
- Current devnet status is still not fully live-demoable: the selected Kamino market fails reserve refresh on-chain (`ReserveStale` / `InvalidOracleConfig`), so the autonomous portfolio demo now falls back to simulated Kamino intents after logging the live failure details.

## Raydium

Verified from official Raydium docs:

- Legacy AMM v4 devnet program: `DRaya7Kj3aMWQSy19kSjvmuwq9docCHofyP9kanQGaav`
- CPMM devnet program: `DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb`
- CLMM devnet program: `DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH`

Repo note:

- This repo's `raydium_lp.devnet.json` schema matches the legacy AMM/OpenBook style account set (`openOrders`, `targetOrders`, `marketEventQueue`), so the likely program for this repo is `DRaya7Kj3aMWQSy19kSjvmuwq9docCHofyP9kanQGaav`.
- Official Raydium docs do not provide a full ready-made devnet pool account set for this exact schema. You still need a real pool's:
  - `poolId`
  - `authority`
  - `baseVault`
  - `quoteVault`
  - `openOrders`
  - `targetOrders`
  - `marketId`
  - `marketEventQueue`
  - `lpMint`

## Orca

Verified from official Orca docs:

- Whirlpool program: `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`
- Devnet WhirlpoolConfig: `FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR`
- Devnet WhirlpoolConfigExtension: `475EJ7JqnRpVLoFVzp2ruEYvWWMCf6Z8KMWRujtXXNSU`
- Devnet concentrated `SOL/devUSDC` token mints:
  - `So11111111111111111111111111111111111111112`
  - `BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k`
- Public concentrated pool parameters used by the repo's Orca demo:
  - `tickSpacing = 64`
  - whirlpool PDA derived from the program/config/token-pair/tick-spacing combination above

Repo note:

- `src/scripts/runOrcaLpDevnet.ts` computes the devnet pool PDA at runtime and opens a one-sided SOL position.
- This path avoids the splash pool example and uses the public concentrated pool so the demo can LP with SOL only.

## Jupiter

Official Jupiter docs state the core programs are deployed on Solana mainnet. Do not rely on a Jupiter "devnet address" story for submission.

## Marinade

No manual protocol address file is required in this repo. The Marinade SDK resolves the cluster-side program/state addresses for the live staking path.
