# Grant Devnet Status

Verified on: 2026-03-13
Repo mode: `IMPLEMENTATION_PATH=defensible_devnet_demo`
Cluster: `devnet`
RPC: `https://devnet.helius-rpc.com/?api-key=bd340d93-b7d3-4ac3-9c55-f861224149f2`

## Executive Summary

PRKT currently demonstrates a live Solana devnet policy runtime with:

- live Solana transaction inspection, simulation, and guarded execution
- live session start and close anchoring
- live proof anchoring and proof verification
- live compressed-storage preference with commitment-backed fallback in defensible demo mode
- shared policy enforcement across Solana and EVM inspection paths

PRKT does not currently demonstrate:

- a live Termina zkSVM prover integration
- a live Termina Data Anchor SDK integration
- unconditional live Neon EVM execution by default

Those paths are either roadmap items or intentionally fail closed unless explicitly enabled.

## Verified Working Now

- `npm.cmd run build`
- `npm.cmd run release:check`
- `npm.cmd run test:devnet`
- `npm.cmd test -- --runInBand tests\\policy\\SandboxExecutor.test.ts tests\\defi\\UniversalDeFiOrchestrator.evm.test.ts`

## Latest Passing Devnet Evidence

- Session id: `6189e15a-b455-4c67-ac04-6b0e682f69de`
- Session anchor tx: `5m97t1eyWcM5NWWRVWSrZU4UP7ZVegFU49DU9tVkC26HXbwKtSfms6x2uTTK1aqpNSobNzDcbscN3LtC8g4ZCrZD`
- Session anchor explorer: `https://explorer.solana.com/tx/5m97t1eyWcM5NWWRVWSrZU4UP7ZVegFU49DU9tVkC26HXbwKtSfms6x2uTTK1aqpNSobNzDcbscN3LtC8g4ZCrZD?cluster=devnet`
- Proof anchor tx: `py6y8hPwbNsbeCQax698EcBVruPzgczdptBmWmz72JskS2iCX7rJNuqytGRESKzjSTCW56mZGVZUTTw83huW8nQ`
- Proof anchor explorer: `https://explorer.solana.com/tx/py6y8hPwbNsbeCQax698EcBVruPzgczdptBmWmz72JskS2iCX7rJNuqytGRESKzjSTCW56mZGVZUTTw83huW8nQ?cluster=devnet`
- Total spent during test: `1.100 SOL / 2 SOL limit`
- Expected rejected action observed: `DAILY_LIMIT_EXCEEDED`

## What Reviewers Can Verify

- `prkt verify-session <sessionId>` verifies the anchored session close commitment against the stored session record.
- `prkt verify-tx <signature>` verifies the anchored policy attestation for a guarded transaction.
- The onchain managed-verifier program id is `3sUkfLW4jtwSQFgdtWyEj8FPedtvKfXSB1J16PMUZhMG`.

## Current Architecture Claims That Are Defensible

- "Policy-enforced autonomous agent runtime on Solana devnet"
- "Cryptographically verifiable policy attestations for guarded execution"
- "On-chain session and proof commitments with public explorer evidence"
- "Light compressed-account preferred path with commitment-backed fallback for devnet reliability"
- "Shared policy engine across Solana and EVM transaction inspection"

## Claims That Should Not Be Used As Present-Tense Facts

- "Live Termina zkSVM proofs are running on devnet"
- "Termina Data Anchor is integrated and live in production form"
- "Neon EVM is enabled by default for live broadcast"
- "All proof paths are zero-knowledge today"

## Recommended Grant Language

Use this wording:

"PRKT is live on Solana devnet today as a policy-enforced agent runtime with cryptographically verifiable policy attestations, on-chain session/proof commitments, and a managed onchain verifier path. The current devnet implementation prefers Light compressed storage and uses commitment-backed fallback anchoring in reviewer-demo mode for reliability. Real zkSVM and Data Anchor integrations remain the next architecture upgrades, not completed present-tense features."
