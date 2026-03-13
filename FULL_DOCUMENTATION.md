# PRKT Full Documentation

PRKT is a local-first Solana agent wallet CLI.

It is designed for a product model closer to "Phantom for agents" than to a shared custodial backend:

- each user runs their own PRKT install
- each install owns its own wallet state
- each agent can have its own persistent wallet
- each action still passes through policy and execution guards before it can hit the chain

This document is the canonical end-to-end reference for setup, operation, security boundaries, user flows, and agent behavior. It is written to be reused directly as website documentation.

## Table of contents

1. Product overview
2. Who this documentation is for
3. Core concepts
4. Architecture and runtime model
5. Custody and key management
6. Local state and filesystem layout
7. Installation
8. First run
9. Environment configuration
10. Command surface overview
11. Wallet workflows
12. Agent workflows
13. Policy model and safety controls
14. Strategy model and agent behavior
15. Live execution vs simulation
16. Monitoring, audit, and operations
17. JSON output and integrations
18. Typical end-to-end flows
19. Production guidance
20. Troubleshooting
21. Security notes and limitations
22. Related documents

## 1. Product overview

PRKT is an operator-facing CLI for managing wallets and autonomous agents on Solana.

The important product property is this:

- users own wallet custody locally by default
- agents can autonomously create or use wallets through the PRKT runtime
- policies constrain what those agents are allowed to do
- live execution is still subject to inspection, limits, and runtime safety checks

PRKT is not a shared wallet server that stores all user secrets centrally.

If 100 users install PRKT, that means 100 separate wallet environments, not one global backend key.

## 2. Who this documentation is for

### End users / operators

This audience needs to know:

- how to install PRKT
- where PRKT stores data
- how agent wallets are created
- how recovery works
- how policies restrict autonomous behavior
- how to run, stop, monitor, and inspect agents

### Agent builders / automation authors

This audience needs to know:

- which strategies are available
- what the runtime will and will not execute
- how policies are resolved
- which actions are live, simulated, or cluster-dependent
- how to validate intent before real execution

### Reviewers / security teams

This audience needs to know:

- custody boundaries
- secret storage behavior
- policy enforcement behavior
- operational files and logs
- production caveats

## 3. Core concepts

### User

The human or system operator who installs PRKT, controls local state, configures the environment, and chooses policies.

### Wallet

A managed Solana wallet stored in PRKT's local registry. Wallet secrets are encrypted at rest.

### Agent

A persistent runtime identity that has:

- an associated managed wallet
- a policy preset
- optional policy overrides
- a strategy
- runtime state such as last run, status, and recent activity

### Strategy

A strategy generates intents or transactions for the agent to attempt. Strategy intent alone is not enough to cause a broadcast.

### Policy

The safety layer that constrains what an agent may do. Policy can restrict transaction count, spend, destinations, mints, programs, and execution mode.

### Approval mode

The policy execution mode:

- `sandbox`
- `live`

`live` means real execution may proceed.

It does not mean "no guards."

## 4. Architecture and runtime model

PRKT can be understood as five stacked layers.

### 4.1 CLI layer

The CLI exposes:

- wallet management
- agent management
- policy inspection and editing
- monitoring
- audit inspection
- configuration and health checks

### 4.2 Registry layer

PRKT persists local state for:

- wallets
- agents
- activity and audit events

This gives PRKT continuity across CLI runs.

### 4.3 Wallet and transaction layer

This layer handles:

- key encryption and decryption
- transaction building
- token account management
- balance queries
- SOL and SPL transfers

### 4.4 Policy layer

This layer inspects proposed actions and applies:

- approval mode
- spend limits
- mint allowlists
- destination allowlists
- program allowlists
- simulation requirements
- suspicious delta rejection
- session expiry and stop conditions

### 4.5 Agent runtime layer

This layer:

- loads the agent
- resolves its policy
- loads its wallet
- constructs the strategy
- runs the strategy
- captures outcomes
- records activity

The agent runtime is where "autonomy" happens, but only inside the wallet and policy boundary defined by the operator.

## 5. Custody and key management

### 5.1 Default custody model: local-per-user

PRKT defaults to `local-per-user` custody.

That means:

- each installation has its own local encrypted wallet state
- each user or machine controls its own secrets
- users do not share a global master key

This is the correct default for a self-serve CLI wallet product.

### 5.2 Wallet encryption at rest

Managed wallet secrets are encrypted using one of two sources:

- `env`
- `local-file`

If `PRKT_WALLET_MASTER_KEY` is set, PRKT uses that value and reports the source as `env`.

If it is not set, PRKT generates a local key file and reports the source as `local-file`.

### 5.3 What `PRKT_WALLET_MASTER_KEY` is for

`PRKT_WALLET_MASTER_KEY` is an optional advanced override.

Use it when:

- you are running PRKT in a managed environment
- you want deterministic key management
- you want the encryption secret supplied by your deployment system instead of by a local generated file

Do not publish one shared `PRKT_WALLET_MASTER_KEY` for all users of the CLI.

For a self-serve installation model, each user or deployment should have its own local key boundary.

Accepted formats:

- 64 hex characters
- base64 encoding of 32 bytes

### 5.4 Recovery keys

When PRKT creates a wallet or agent wallet, it returns a one-time `recoveryKey`.

That recovery key is used to export the underlying secret key later.

Important rules:

- store the recovery key immediately
- treat it as highly sensitive
- do not assume PRKT can regenerate it later

Sensitive export commands:

- `prkt wallet export-secret --name <name> --recovery-key <key>`
- `prkt agent export-wallet --agent <name> --recovery-key <key>`

### 5.5 Optional managed signer mode

PRKT can also be deployed with a remote signer boundary using:

- `REMOTE_SIGNER_URL`
- `REMOTE_SIGNER_BEARER_TOKEN`
- `REMOTE_SIGNER_PUBKEY`

That changes who performs signing, but it does not remove the policy layer.

The policy layer still decides what may proceed.

## 6. Local state and filesystem layout

PRKT stores persistent local state in a stable per-user data directory.

Default locations:

- Windows: `%APPDATA%\PRKT\`
- macOS: `~/Library/Application Support/PRKT/`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/prkt/`

Optional override:

- `PRKT_CLI_HOME`

Typical files:

- `cli-wallets.json`
- `cli-agents.json`
- `cli-activity.json`
- `platform-wallet-master.key`

These are local operational files. They are not the authoritative record of on-chain state.

### 6.1 What `PRKT_CLI_HOME` does

`PRKT_CLI_HOME` tells PRKT exactly where to store its local state.

Use it when:

- you want a predictable path
- you are deploying inside a container or VM
- you want PRKT state on a persistent mounted volume

For ordinary self-serve installs, the default OS app-data path is usually sufficient.

## 7. Installation

### 7.1 Install the published CLI

```bash
npm install -g @prktsol/prkt
prkt --help
```

### 7.2 Run from source

```bash
git clone <repo-url>
cd PRKT
npm install
npm run cli -- --help
```

### 7.3 Runtime requirement

PRKT requires:

- Node `>=18`

## 8. First run

The recommended first-run sequence is:

```bash
prkt init
prkt config show
prkt doctor
```

### 8.1 What `prkt init` does

`prkt init` initializes and reports local install state.

It shows:

- `cliDataDir`
- `cliDataDirWritable`
- `custodyModel`
- `masterKeySource`
- `policyExecutionModel`
- recommended next steps

### 8.2 What `prkt config show` does

`prkt config show` shows runtime configuration, including:

- cluster
- RPC endpoint
- live protocol flags
- custody model
- wallet key source
- policy execution model

### 8.3 What `prkt doctor` does

`prkt doctor` runs health checks for:

- cluster detection
- RPC connectivity
- signer or treasury presence
- data directory writability
- custody model
- wallet key source
- policy execution model
- live-path flags

If `cli-data-dir-writable` fails, PRKT can see the directory but cannot persist local state safely.

## 9. Environment configuration

Start from the repository example:

```bash
cp .env.example .env
```

If you are on Windows PowerShell, create the file manually or copy it in Explorer.

### 9.1 Core environment variables

- `SOLANA_RPC_URL`
- `SOLANA_RPC_FALLBACK_URL`
- `KORA_RPC_URL`
- `KORA_MOCK_MODE`
- `USDC_MINT`
- `POLICY_SESSION_TTL_MINUTES`

### 9.2 Local state variables

- `PRKT_CLI_HOME`
- `PRKT_WALLET_MASTER_KEY`

### 9.3 Demo and devnet funding variables

- `AGENT_PRIVATE_KEY`
- `DEVNET_TREASURY_PRIVATE_KEY`

### 9.4 Remote signer variables

- `REMOTE_SIGNER_URL`
- `REMOTE_SIGNER_BEARER_TOKEN`
- `REMOTE_SIGNER_PUBKEY`

### 9.5 Live-path flags

- `ENABLE_LIVE_SWAP_PATH`
- `ENABLE_LIVE_RAYDIUM_LP`
- `ENABLE_LIVE_KAMINO`
- `ENABLE_LIVE_MARINADE`
- `UNIVERSAL_DEFI_LIVE_FIRST`
- `KAMINO_LIVE_CONFIG_PATH`

### 9.6 Example environment choices

#### Self-serve local installation

Use:

- default local state path
- no shared global master key
- devnet RPC while learning
- live flags off unless you explicitly need them

#### Managed or hosted execution

Use:

- `PRKT_CLI_HOME` on persistent storage
- `PRKT_WALLET_MASTER_KEY` from your deployment secrets
- remote signer if required by your control model

## 10. Command surface overview

PRKT currently exposes these top-level command groups:

- `init`
- `wallet`
- `token`
- `policy`
- `agent`
- `monitor`
- `demo`
- `audit`
- `config`
- `doctor`
- `completion`

### 10.1 Global JSON output

You can request machine-readable output with the global `--json` flag.

Example:

```bash
prkt --json config show
prkt --json agent show --agent agent-a
```

This is the preferred mode for building a GUI, website backend, or automation layer on top of PRKT.

## 11. Wallet workflows

Wallets are the low-level custody primitives in PRKT.

In practice, many operators will create agents rather than standalone wallets, but the wallet commands are still useful for treasury operations and direct testing.

### 11.1 Create a managed wallet

```bash
prkt wallet create --name treasury
```

What happens:

- PRKT generates a wallet
- PRKT encrypts the secret locally
- PRKT stores the wallet in the local registry
- PRKT returns a one-time `recoveryKey`
- PRKT ensures there is a matching agent profile for that wallet name

### 11.2 List wallets

```bash
prkt wallet list
```

### 11.3 Show one wallet

```bash
prkt wallet show --name treasury
```

### 11.4 Fund a wallet

```bash
prkt wallet fund --name treasury --sol 1
```

Funding behavior:

- if a devnet treasury is configured, PRKT funds from that treasury first
- otherwise it attempts an airdrop-oriented funding path

This is primarily intended for devnet and demo operation.

### 11.5 Check wallet balances

SOL:

```bash
prkt wallet balance --name treasury
```

SPL:

```bash
prkt wallet balance-spl --name treasury --mint <mint-address>
```

### 11.6 Transfer assets

SOL:

```bash
prkt wallet transfer-sol --from treasury --to <recipient-pubkey> --amount 0.1
```

SPL:

```bash
prkt wallet transfer-spl --from treasury --to <recipient-owner-pubkey> --mint <mint-address> --amount 10
```

### 11.7 Export the wallet secret

```bash
prkt wallet export-secret --name treasury --recovery-key <recovery-key>
```

Use this only when strictly necessary.

This command reveals the wallet secret material and should be treated as a high-sensitivity recovery path.

## 12. Token workflows

PRKT includes minimal SPL token helpers for test and demo flows.

### 12.1 Create a demo mint

```bash
prkt token mint-demo --authority treasury --decimals 6 --amount 1000
```

This creates:

- a demo mint
- the authority's associated token account if needed
- an initial token balance for the authority wallet

### 12.2 Create an associated token account

```bash
prkt token create-ata --owner treasury --mint <mint-address>
```

## 13. Agent workflows

Agents are the main abstraction for autonomous behavior in PRKT.

An agent is not just a wallet. It is a wallet plus state plus strategy plus policy.

### 13.1 Create an agent

```bash
prkt agent create --agent agent-a --owner user-123
```

What this does:

- creates a managed wallet for the agent
- stores encrypted wallet state locally
- creates an agent record
- assigns the default policy preset
- returns a one-time `recoveryKey`

Returned fields include:

- `agent`
- `wallet`
- `publicKey`
- `ownerId`
- `defaultPolicyPreset`
- `masterKeySource`
- `recoveryKey`

### 13.2 List agents

```bash
prkt agent list
```

Typical fields:

- `name`
- `ownerId`
- `policyMode`
- `policyPreset`
- `status`
- `strategy`
- `wallet`
- `lastRunAt`

### 13.3 Inspect one agent

```bash
prkt agent show --agent agent-a
```

This returns both persisted state and the resolved policy view.

### 13.4 Fund an agent wallet

```bash
prkt agent fund --agent agent-a --sol 1
```

### 13.5 Check agent balance

```bash
prkt agent balance --agent agent-a
```

### 13.6 Export the agent wallet

```bash
prkt agent export-wallet --agent agent-a --recovery-key <recovery-key>
```

### 13.7 Run an agent once

```bash
prkt agent run --agent agent-a --strategy memo-heartbeat
```

This is the simplest way to trigger autonomous behavior.

PRKT will:

- load the agent
- set it active
- resolve its policy
- construct the selected strategy
- run one execution cycle
- store resulting activity and outcome state

### 13.8 Run all active agents once

```bash
prkt agent run-all
```

This is useful for scheduler-driven or cron-style operation.

### 13.9 Stop an agent

```bash
prkt agent stop --agent agent-a
```

This marks the agent as stopped in local state.

### 13.10 View agent logs

```bash
prkt agent logs --agent agent-a
```

These logs are sourced from PRKT's local activity store.

## 14. Policy model and safety controls

The policy system is the reason PRKT can support autonomous agents without handing them unrestricted wallet authority.

### 14.1 What policy controls

Policies can constrain:

- approval mode
- maximum SOL spend per transaction
- maximum SPL spend per transaction
- maximum transactions per session
- maximum transactions per day
- session TTL
- allowed mint list
- allowed transfer destinations
- allowed close-account destinations
- extra allowed program IDs
- opaque-program handling
- simulation requirement
- suspicious-balance-delta rejection

### 14.2 Presets

Current presets:

- `observe-only`
- `simulate-only`
- `auto-devnet-safe`
- `guarded-live`
- `custom`

Default preset:

- `auto-devnet-safe`

### 14.3 How presets map to execution mode

PRKT treats:

- `guarded-live` as `live`
- all other shipped presets as `sandbox`

### 14.4 Inspect presets

```bash
prkt policy presets
```

### 14.5 Inspect one agent policy

```bash
prkt policy show --agent agent-a
```

This returns:

- stored overrides
- current policy mode
- preset
- fully resolved policy config

### 14.6 Set a preset

```bash
prkt policy set-preset --agent agent-a --preset guarded-live
```

### 14.7 Apply policy overrides

Example:

```bash
prkt policy set-limits --agent agent-a --approval-mode sandbox --max-sol-per-tx-lamports 100000000 --max-transactions-per-session 3 --allowed-destinations <pubkey-a>,<pubkey-b>
```

Supported override flags:

- `--approval-mode <sandbox|live>`
- `--max-sol-per-tx-lamports <n>`
- `--max-spl-per-tx-raw <n>`
- `--max-transactions-per-session <n>`
- `--max-transactions-per-day <n>`
- `--session-ttl-minutes <n>`
- `--allowed-mints <csv>`
- `--allowed-close-destinations <csv>`
- `--allowed-destinations <csv>`
- `--extra-program-ids <csv>`
- `--allow-opaque-program-ids <csv>`
- `--deny-unknown-instructions <true|false>`
- `--require-simulation-success <true|false>`
- `--reject-suspicious-balance-deltas <true|false>`

### 14.8 Clear overrides

```bash
prkt policy clear-overrides --agent agent-a
```

### 14.9 Validate an intent before execution

```bash
prkt policy validate-intent --agent agent-a --intent-file ./intent.json
```

Supported intent file types:

- `write-memo`
- `transfer-sol`
- `transfer-spl`

Examples:

Write memo:

```json
{
  "type": "write-memo",
  "memo": "agent heartbeat"
}
```

Transfer SOL:

```json
{
  "type": "transfer-sol",
  "to": "RecipientPublicKeyHere",
  "lamports": 1000000
}
```

Transfer SPL:

```json
{
  "type": "transfer-spl",
  "mint": "MintAddressHere",
  "toOwner": "RecipientOwnerPublicKeyHere",
  "amountRaw": "1000000"
}
```

This command is especially useful for:

- UI preflight checks
- policy review
- explaining why an action would be allowed or blocked

## 15. Strategy model and agent behavior

An agent does not "decide freely" in PRKT.

It acts through a strategy selected by the operator, and every resulting transaction is still subject to policy and runtime checks.

### 15.1 Available strategy names

Current strategy names wired into the CLI runtime:

- `memo-heartbeat`
- `simple-scripted-transfer`
- `universal-defi`

### 15.2 Strategy details

#### `memo-heartbeat`

This is the safest starter strategy.

It is useful for:

- proving the runtime loop works
- testing policy application
- validating monitoring and audit flows

#### `simple-scripted-transfer`

This strategy expects configuration such as a destination address.

Important:

- the current CLI can run this strategy name
- but the CLI does not currently expose a first-class command for editing the required strategy config
- it is therefore better suited for programmatic or demo-driven use than for casual CLI users

#### `universal-defi`

This is the strategy most closely aligned with autonomous DeFi behavior.

It evaluates a bundle of capability snapshots and may attempt actions across areas like:

- trading
- staking
- LP management
- lending
- borrowing

Whether any of those actions actually execute depends on:

- the current cluster
- protocol support
- live flags
- wallet funding
- policy constraints

### 15.3 What an agent can actually do

For an agent action to reach the chain, all of the following must line up:

- the strategy generates the intent
- the current cluster supports the path
- the protocol path is enabled
- the agent wallet can sign or the signer boundary is available
- the policy allows it
- the transaction inspection passes

This is the most important mental model in PRKT:

Autonomy exists inside a policy-enforced wallet runtime. It is not unconstrained freedom.

## 16. Live execution vs simulation

Not every protocol path is equally live on every cluster.

PRKT supports a mix of:

- live execution
- simulated execution
- live-first with simulated fallback

### 16.1 Current practical model

Based on the repository's current behavior:

- some devnet protocol paths can run live when correctly configured
- some paths are intentionally simulated because the protocol or liquidity assumptions are not available on devnet
- some paths try live execution first and fall back when the environment is unsuitable

### 16.2 Why this matters

The same agent strategy can produce different outcomes across:

- devnet
- test environments
- mainnet-like production environments

You should never document or present PRKT as "every strategy always executes live."

The correct framing is:

- PRKT exposes autonomous execution primitives
- the final execution mode depends on environment and policy

## 17. Monitoring, audit, and operations

PRKT includes operational visibility commands.

### 17.1 Monitor overview

```bash
prkt monitor overview
```

This summarizes:

- agents
- last action
- last signature
- status
- policy mode
- tracked balances

### 17.2 Live-refresh monitoring

```bash
prkt monitor watch --interval 5
```

Optional:

- `--iterations <n>`

### 17.3 Wallet balances view

```bash
prkt monitor balances
```

### 17.4 Recent transaction activity

```bash
prkt monitor txs
```

### 17.5 Agent runtime state

```bash
prkt monitor agents
```

### 17.6 Audit log

```bash
prkt audit --limit 200
```

The audit log is useful operational telemetry, but the authoritative source of truth for balances and execution remains on-chain state.

## 18. JSON output and integrations

PRKT is CLI-first, but it is also integration-friendly.

Add `--json` to get machine-readable output:

```bash
prkt --json init
prkt --json doctor
prkt --json wallet list
prkt --json agent show --agent agent-a
```

This is the recommended basis for:

- a desktop wrapper
- a website backend
- a control plane UI
- scheduler integrations
- CI or ops checks

### 18.1 Typed package imports

The root package also exposes a typed Node SDK surface for direct integration.

Example:

```js
const {
  WalletManager,
  PolicyEngine,
  SessionAnchor,
  ProofAnchor
} = require("@prktsol/prkt");
```

This surface is intended for backend and automation composition.

## 19. Typical end-to-end flows

### 19.1 Fastest safe local-first walkthrough

```bash
prkt init
prkt config show
prkt doctor
prkt agent create --agent my-agent --owner me
prkt policy show --agent my-agent
prkt agent fund --agent my-agent --sol 1
prkt agent run --agent my-agent --strategy memo-heartbeat
prkt agent logs --agent my-agent
prkt audit --limit 50
```

### 19.2 Promote an agent toward live behavior carefully

```bash
prkt policy set-preset --agent my-agent --preset guarded-live
prkt policy set-limits --agent my-agent --max-sol-per-tx-lamports 100000000 --max-transactions-per-session 3 --max-transactions-per-day 10
prkt policy show --agent my-agent
```

This gives you a tighter live-capable envelope instead of a loose default.

### 19.3 Treasury-style wallet flow

```bash
prkt wallet create --name treasury
prkt wallet fund --name treasury --sol 2
prkt wallet balance --name treasury
prkt token mint-demo --authority treasury --decimals 6 --amount 1000
prkt wallet balance-spl --name treasury --mint <mint-address>
```

### 19.4 Policy preflight flow for a UI

1. User edits an intended action in a UI.
2. The UI writes an intent JSON file or equivalent payload.
3. The backend invokes `prkt policy validate-intent`.
4. The UI shows whether the action would pass policy.
5. Only then does the user or scheduler trigger execution.

## 20. Production guidance

### 20.1 If you are shipping PRKT as a self-serve product

The correct product statement is:

- each user gets local wallet custody by default
- each user's install has its own encrypted wallet state
- agents act within user-defined policy constraints
- PRKT is production-capable for technical users and operators

Do not describe it as:

- a shared wallet backend
- a single hosted key for all users
- unconstrained autonomous wallet execution

### 20.2 If you are hosting PRKT operationally

Use:

- persistent `PRKT_CLI_HOME`
- managed secret injection for `PRKT_WALLET_MASTER_KEY`
- remote signer configuration if your operating model requires it
- explicit live-flag management
- operator runbooks for funding, recovery, and emergency controls

### 20.3 Recommended onboarding sequence for website docs

For website structure, the clean top-level ordering is:

1. What PRKT is
2. Local custody and security model
3. Installation
4. First run
5. Wallets
6. Agents
7. Policies
8. Strategy and autonomy model
9. Monitoring and audit
10. Production deployment notes
11. Troubleshooting

## 21. Troubleshooting

### `Wallet '<name>' not found`

The wallet does not exist in the current PRKT data directory.

Check:

- the wallet name
- the current OS user
- `PRKT_CLI_HOME`

### `Unknown wallet/agent '<name>'`

The provided identifier matches neither a managed wallet nor an agent in the current local state.

### `Unknown agent '<name>'`

The agent does not exist in the current local registry.

### `cli-data-dir-writable` failed

PRKT can locate the expected state directory but cannot write to it.

Fix by:

- switching to a writable account
- correcting filesystem permissions
- setting `PRKT_CLI_HOME` to a writable path

### `Wallet master key is not configured`

PRKT could not find either:

- `PRKT_WALLET_MASTER_KEY`
- or the generated local master key file

Run `prkt init` or ensure the local data directory exists and is writable.

### `Unsupported intent type for validate-intent`

Current supported intent types are:

- `write-memo`
- `transfer-sol`
- `transfer-spl`

### `Program blocked: <id> is not whitelisted`

The current policy does not allow that program.

Fix by reviewing:

- the preset
- extra allowed program IDs
- opaque program settings

### `Session blocked: session has expired`

The policy session TTL has elapsed.

Adjust:

- the session TTL
- or the execution cadence

### RPC connectivity failures

If `prkt doctor` reports `rpc-connectivity` failure:

- verify `SOLANA_RPC_URL`
- verify network access
- verify the cluster is reachable

## 22. Security notes and limitations

PRKT is strong on operator control, but its security properties still depend on correct usage.

Important boundaries:

- local custody means local machine security matters
- a recovery key is sensitive secret material
- live flags should be enabled deliberately
- devnet success does not guarantee mainnet success
- policy quality defines a large part of the risk envelope
- agent autonomy in PRKT is bounded autonomy, not unlimited autonomy

The most accurate security summary is:

PRKT gives autonomous agents wallet capability only inside a user-owned, policy-governed execution boundary.

## 23. Related documents

- [README.md](./README.md)
- [CLI.md](./CLI.md)
- [CLI_QUICKSTART.md](./CLI_QUICKSTART.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [COMPATIBILITY.md](./COMPATIBILITY.md)
- [DEVNET_PROTOCOL_ADDRESSES.md](./DEVNET_PROTOCOL_ADDRESSES.md)
