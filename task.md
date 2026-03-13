PRKT: Autonomous Agentic Wallet

Objective: Build a policy-enforced, gasless (Kora-powered) Solana wallet for autonomous agents.

Status Key: Pending | In Progress | Completed | Blocked

## Execution Plan

1. Foundation
   Dependencies: none
   Deliverables: `package.json`, TypeScript config, Jest config, env template, `.gitignore`
   Exit Criteria: project can install and run TypeScript/Jest entrypoints locally

2. Wallet Identity Layer
   Dependencies: Foundation
   Deliverables: `WalletManager`, safe env loading, Devnet key generation script
   Exit Criteria: a generated or loaded keypair can expose a public key without logging secret material

3. Policy Engine
   Dependencies: Wallet Identity Layer
   Deliverables: policy schema types, `PolicyGuard`, transaction validation tests
   Exit Criteria: disallowed transfers are rejected before signing or submission

4. Gasless Transport
   Dependencies: Policy Engine
   Deliverables: Kora RPC client wiring, gasless send path, Devnet memo transaction check
   Exit Criteria: fee payer abstraction works for a funded paymaster path

5. Agent Runtime
   Dependencies: Gasless Transport
   Deliverables: `SKILLS.md`, market simulation, policy-to-execution pipeline
   Exit Criteria: decision flow reaches guarded gasless execution

6. Demo Harness
   Dependencies: Agent Runtime
   Deliverables: attack simulation, multi-agent concurrency harness, CLI status output
   Exit Criteria: blocked attack path and concurrent agent runs are reproducible

7. Submission
   Dependencies: Demo Harness
   Deliverables: README deep dive, final Devnet logs, demo-ready CLI
   Exit Criteria: judges can review architecture and replay results

## Immediate Next Steps

- Provide a reachable live `KORA_RPC_URL` and set `KORA_MOCK_MODE=false` for real paymaster execution
- Expand `EXTRA_WHITELISTED_PROGRAMS` for the exact routed swap programs used in live Jupiter transactions
- Complete Phase 6.3 by recording five successful live Devnet swaps

## Phase 1: Environment & Scaffolding

Goal: Establish the sandbox and core dependencies.

- [x] Task 1.1: Project Initialization
  Action: Initialize a TypeScript project with ts-node, jest, and @solana/web3.js.
  Requirement: Install solana-agent-kit and dotenv.
  Log: `npm init` and dependency tree audit.
  Current State: complete; dependencies installed and local build/test scripts are working.

- [x] Task 1.2: Identity Generation
  Action: Create a `WalletManager` class that can programmatically generate/load a `Keypair`.
  Security: Implement a `.env` guard to ensure private keys are never logged.
  Verification: Generate a Devnet address and log the public key.
  Current State: complete; generated Devnet wallet verified and public key logging is safe.

## Phase 2: The "Sentinel" Policy Engine (Innovation Layer)

Goal: Create the security layer that distinguishes this from a standard bot.

- [x] Task 2.1: Schema Definition
  Action: Create `types/policy.ts` defining `MaxSpend`, `WhitelistedPrograms`, and `SessionExpiry`.
  Log: Define the JSON structure for the agent's constraints.
  Current State: schema scaffolded with a constraints object and transfer destination whitelist.

- [x] Task 2.2: The Guard Logic
  Action: Write a `PolicyGuard` class that intercepts a `VersionedTransaction`.
  Logic: It must parse instructions to ensure no `SystemProgram.transfer` exists unless the destination is whitelisted.
  Verification: Unit test where a "malicious" transaction is correctly blocked.
  Current State: complete; guard is implemented and unit tests pass for blocked and allowed flows.

## Phase 3: Kora Protocol Integration (Gasless)

Goal: Implement fee abstraction so the agent is self-sustaining.

- [x] Task 3.1: Kora Paymaster Setup
  Action: Integrate the Kora RPC endpoint for Devnet.
  Logic: Implement a `signAndSendGasless` method that requests a fee-payer signature from Kora.
  Verification: Execute a simple Memo program transaction on Devnet with `0 SOL` in the agent wallet.
  Current State: complete in code; local verification runs in mock mode by default and flips to live mode when `KORA_MOCK_MODE=false` with a reachable `KORA_RPC_URL`.

## Phase 4: Agent Autonomy & Skillset

Goal: Give the agent "Brain" power and instructions.

- [x] Task 4.1: SKILLS.md Creation
  Action: Author the `SKILLS.md` file using the provided template (wallet rotation, swap capability, policy awareness).
  Current State: complete; `SKILLS.md` documents wallet rotation, gasless swap flow, and policy-aware execution.

- [x] Task 4.2: Autonomous Trade Loop
  Action: Build a `simulateMarketAction()` function. The agent should "decide" to swap `0.01 SOL` for `USDC` based on a mock price feed.
  Integration: Link the decision logic to the `PolicyGuard -> KoraSigner` path.
  Log: Console output showing `Decision -> Policy Check -> Gasless Execution.`
  Current State: complete; `trade:simulate` executes the full decision pipeline with memo-backed swap intents by default and can switch to the live Jupiter swap path when enabled.

## Phase 5: Test Harness & Simulation

Goal: Demonstrate the "Sentinel" in action for the judges.

- [x] Task 5.1: The "Hacker" Simulation
  Action: Create a script `npm run simulate-attack`.
  Scenario: The agent logic is "compromised" and tries to drain the wallet to a random address.
  Expected Outcome: The `PolicyGuard` throws a `SecurityViolation` error and stops the transaction.
  Current State: complete; the script reliably throws and logs a blocked unauthorized transfer.

- [x] Task 5.2: Multi-Agent Spawn
  Action: Update the manager to handle an array of `3` agents, each with unique keys and policy limits.
  Verification: Run a stress test showing all `3` performing concurrent tasks.
  Current State: complete; `stress:agents` spawns three unique agents and runs concurrent guarded gasless tasks.

## Phase 6: Final Submission Prep

Goal: Polish and Documentation.

- [x] Task 6.1: README & Deep Dive
  Action: Write the technical explanation of "Why this is secure" (session keys + Kora abstraction).
  Current State: complete; `README.md` documents the architecture, security model, and demo flow.

- [x] Task 6.2: Demo Recording/CLI UI
  Action: Create a clean CLI dashboard using `chalk` or `blessed` to show real-time agent status.
  Current State: complete; `dashboard:demo` renders a colored terminal dashboard for judges.

- [ ] Task 6.3: Final Devnet Run
  Action: Record a log of `5` successful autonomous swaps on Devnet.

## Phase 7: Protocol-Specific DeFi Expansion

Goal: Move from generic DeFi intents to protocol-specific autonomous strategy adapters.

- [x] Task 7.1: DeFi Policy Surface
  Action: Extend `PolicyConstraints` with protocol-aware controls for staking, LP, and lending.
  Current State: complete; protocol policies exist for Marinade, Raydium, and Kamino.

- [x] Task 7.2: Protocol Adapter Modules
  Action: Add explicit protocol adapter classes for:
  - Marinade-style staking
  - Raydium-style LP management
  - Kamino-style lending / yield
  Exit Criteria: each protocol has a dedicated intent builder that the runtime can call directly.
  Current State: complete; protocol adapters now exist under `src/defi/adapters/`.

- [x] Task 7.3: Coordinator Refactor
  Action: Refactor the DeFi coordinator so each strategy calls a dedicated adapter instead of embedding protocol details inline.
  Exit Criteria: DeFi strategy logs name the adapter-backed protocol path used for execution.
  Current State: complete; `DeFiCoordinator` now routes through Marinade, Raydium, and Kamino adapters.

- [x] Task 7.4: Validation
  Action: Add tests for each protocol adapter and the refactored coordinator flow.
  Exit Criteria: automated coverage confirms protocol-specific builders and full-suite orchestration remain stable.
  Current State: complete; adapter tests, DeFi policy tests, coordinator tests, build, and a mock `defi:all` run all pass.
