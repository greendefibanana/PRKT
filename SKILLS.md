# PRKT Skills

PRKT ships with a small set of operator-facing runtime skills that are meant to be safe on devnet and production-style on constrained environments.

## Wallet Rotation

- Generate or load an agent wallet without printing secret material.
- Prefer remote signing boundaries when available.
- Fall back to locally managed devnet wallets only for demo and operator-owned environments.

## Gasless Swap Flow

- Route autonomous swap intents through the policy layer first.
- Simulate before broadcast.
- Use gasless or delegated execution paths only after policy approval and runtime checks pass.
- Preserve explicit logs for decision, policy result, simulation result, and broadcast signature.

## Policy-Aware Execution

- Deny unknown or unapproved spend vectors by default.
- Enforce session, destination, mint, and spend limits before execution.
- Keep auditability first: every allow or deny decision should be explainable from stored activity or on-chain evidence.

## Devnet Operating Standard

- Treat devnet as a production rehearsal environment.
- Prefer deterministic scripts, explicit fallbacks, and verifiable memo anchors over ad hoc manual steps.
- Document every path that is simulated, live, or live-first with fallback.
