# Production Readiness TODO

This file tracks the release gates required for a production-style devnet posture and a clean migration path toward mainnet.

## P0 Blockers

- [x] Local release readiness script exists and is wired into `npm run release:check`.
- [x] Build, CLI help, coverage, and dry-run packaging are exercised by the release check.
- [x] Repository release artifacts required by the readiness script are present.

## P1 Security Hardening (must complete before any mainnet use)

- [x] Partial remote signer configuration fails closed.
- [x] Local demo wallet custody is explicitly documented as non-production custody.
- [x] Sandbox execution branches for Solana and EVM paths are covered by automated tests.
- [x] Policy attestation rejection paths fail closed before broadcast.

## P1 End-to-End Live Paths

- [x] Devnet live paths are explicitly classified as live, simulated, or live-first with fallback.
- [x] Compression and proof side effects are exercised in the sandbox execution test suite.
- [x] Release readiness verifies the CLI package can be built and packed locally.

## P0 Test and Release Gates

- [x] `README.md`, `.env.example`, and `SKILLS.md` are present.
- [x] Coverage thresholds are enforced for policy modules.
- [x] Sandbox coverage meets the current policy threshold.

## Mainnet Deployment Gate (hard stop)

- [x] Devnet production-rehearsal gates in this repository are green.
- [x] Mainnet promotion remains a separate go/no-go decision after external signer, protocol, and operational controls are validated against mainnet infrastructure.

## P2 Follow-Up Backlog

- [ ] Publish a stable SDK entrypoint with declaration output and documented compatibility guarantees.
- [ ] Replace memo-backed devnet compression and proof placeholders with the intended production zk/compression stack.
- [ ] Add HSM/KMS-backed signer support for higher-value operational deployments.
- [ ] Add deterministic live-devnet smoke tests for all supported protocol adapters behind opt-in environment flags.
