# ZK Policy Proofs

PRKT's current devnet implementation does not use a live Termina zkSVM proving SDK.

PRKT now has two proof-verification paths on devnet:

1. Offchain attestation path for the existing wallet stack:
   - `PolicyCircuit.prove()` runs the policy checks locally and builds a signed attestation containing the intent hash, policy hash, and the check outcomes.
   - The attestation is signed with the agent's Ed25519 keypair using `tweetnacl.sign.detached`.
   - `ProofAnchor.anchorProof()` stores the attestation in compressed devnet storage when available, with commitment-backed fallback in `defensible_devnet_demo` mode.
   - `ProofAnchor.verifyProof()` reconstructs the attestation digest and verifies the detached signature against the anchored public key.

2. Onchain verifier path for managed vault execution:
   - `programs/policy_guard` is a deployed Solana program on devnet.
   - The verifier path uses the Solana Ed25519 precompile plus instruction introspection to verify a signed managed-transfer payload onchain before releasing funds from the program vault.
   - The TypeScript client for this path is in `src/onchain/policyGuardProgram.ts`.
   - Current deployed devnet program id: `3sUkfLW4jtwSQFgdtWyEj8FPedtvKfXSB1J16PMUZhMG`.

Both paths are cryptographically verifiable, but neither is a zero-knowledge proof yet.

Accurate status for grant reviewers:

- Current implementation: Ed25519-signed policy proofs, with an onchain verifier path for managed vault execution and compressed-account storage for proof/session/policy state
- Verification model: third parties can fetch compressed proof state when available, or inspect the devnet onchain verifier program and commitment transaction logs directly
- Planned stronger-proof path: replace the Ed25519 proof payload with a real zk verifier backend when the chosen zk proving stack is stable for production
