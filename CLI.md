# PRKT CLI Documentation

This document is the complete reference for the PRKT command-line interface.

For the full end-to-end product guide, see:
- [FULL_DOCUMENTATION.md](./FULL_DOCUMENTATION.md)

- Published binary entrypoint: `prkt ...`
- Published devnet verifier: `prkt-devnet-matrix`
- Source entrypoint: `npm run cli -- ...`
- CLI name in help output: `prkt`
- Global machine-readable output mode: `--json`

## 1) CLI Purpose

The CLI is an operations/control layer on top of the existing architecture.

It does not move core domain logic into command handlers.

- Wallet and token execution is delegated to Wallet Core services.
- Policy inspection is delegated to Policy layer modules.
- Agent execution is delegated to Agent Runner and DeFi orchestration.
- Monitoring/audit reads lightweight persistent activity state.

## 2) Quickstart

1. Install the CLI:
```bash
npm install -g @prktsol/prkt
```
Alternative, from source:
```bash
npm install
```
2. Confirm CLI is reachable and initialize local state:
```bash
prkt --help
prkt init
prkt-devnet-matrix
```
3. Create a wallet:
```bash
prkt wallet create --name treasury
```
4. Check balance:
```bash
prkt wallet balance --name treasury
```

## 3) Global Options

- `--json`: output JSON payloads (tables/pretty formatting disabled)

Example:
```bash
prkt --json wallet list
```

## 3.2) Devnet Tryability Runner
Run the end-to-end devnet feature matrix. This is the fastest way to exercise the wallet stack and emit reviewable artifacts.

Published install:
```bash
prkt-devnet-matrix
```

From source:
```bash
npm run demo:feature-matrix:devnet
```

Artifacts:
- `artifacts/devnet-feature-matrix.json`
- `artifacts/devnet-feature-matrix.md`

Optional env flags:
- `PRKT_DEVNET_MATRIX_INCLUDE_PROTOCOL_LIVE=1`
- `PRKT_DEVNET_MATRIX_INCLUDE_STRESS=1`
- `PRKT_DEVNET_MATRIX_INCLUDE_EXPORTS=1`

## 3.1) init
Bootstrap local PRKT state for the current user install.

```bash
prkt init
```

Outputs:

- current custody model
- local CLI data directory
- whether that directory is writable
- wallet key source (`local-file` by default)
- recommended next steps

## 4) Wallet Commands

### wallet create
Create a managed wallet and register a matching agent profile.

```bash
npm run cli -- wallet create --name <name>
```

### wallet list
List all managed wallets.

```bash
npm run cli -- wallet list
```

### wallet show
Show one managed wallet.

```bash
npm run cli -- wallet show --name <name>
```

### wallet fund
Fund wallet from the configured devnet treasury if present, otherwise request a devnet airdrop.

```bash
npm run cli -- wallet fund --name <name> --sol <amount>
```

### wallet balance
Get SOL balance.

```bash
npm run cli -- wallet balance --name <name>
```

### wallet balance-spl
Get SPL token balance for a mint.

```bash
npm run cli -- wallet balance-spl --name <name> --mint <mint>
```

### wallet transfer-sol
Transfer SOL. `--from` accepts wallet name or agent name.

```bash
npm run cli -- wallet transfer-sol --from <agentOrWallet> --to <pubkey> --amount <amount>
```

### wallet transfer-spl
Transfer SPL token amount in UI units. `--from` accepts wallet or agent.

```bash
npm run cli -- wallet transfer-spl --from <agentOrWallet> --to <pubkey> --mint <mint> --amount <amount>
```

## 5) Token Commands

### token mint-demo
Create a new demo mint and mint amount to authority ATA.

```bash
npm run cli -- token mint-demo --authority <wallet> --decimals <n> --amount <amount>
```

### token create-ata
Create ATA for owner wallet and mint (if missing).

```bash
npm run cli -- token create-ata --owner <wallet> --mint <mint>
```

## 6) Policy Commands

### policy show
Show the resolved provider policy configuration for an agent, including preset and overrides.

```bash
npm run cli -- policy show --agent <agent>
```

### policy presets
List available provider policy presets.

```bash
npm run cli -- policy presets
```

### policy set-preset
Assign a provider policy preset to an agent.

```bash
npm run cli -- policy set-preset --agent <agent> --preset <preset>
```

Supported presets:
- `observe-only`
- `simulate-only`
- `auto-devnet-safe`
- `guarded-live`
- `custom`

### policy set-limits
Set or replace persisted policy overrides for an agent.

```bash
npm run cli -- policy set-limits --agent <agent> --max-sol-per-tx-lamports 500000000
```

Useful options:
- `--approval-mode <sandbox|live>`
- `--max-sol-per-tx-lamports <n>`
- `--max-spl-per-tx-raw <n>`
- `--max-transactions-per-session <n>`
- `--max-transactions-per-day <n>`
- `--session-ttl-minutes <n>`
- `--allowed-mints <csv>`
- `--allowed-destinations <csv>`
- `--allowed-close-destinations <csv>`
- `--extra-program-ids <csv>`
- `--allow-opaque-program-ids <csv>`
- `--deny-unknown-instructions <true|false>`
- `--require-simulation-success <true|false>`
- `--reject-suspicious-balance-deltas <true|false>`

### policy clear-overrides
Clear persisted policy overrides for an agent while keeping the assigned preset.

```bash
npm run cli -- policy clear-overrides --agent <agent>
```

### policy validate-intent
Build and inspect supported intent types using `PolicyEngine`.

Supported intent file `type` values:
- `write-memo`
- `transfer-sol`
- `transfer-spl`

```bash
npm run cli -- policy validate-intent --agent <agent> --intent-file <file>
```

Example intent file:
```json
{
  "type": "transfer-sol",
  "to": "<recipient-pubkey>",
  "lamports": 1000000
}
```

## 7) Agent Commands

### agent list
List managed agents and state.

```bash
npm run cli -- agent list
```

### agent show
Show one agent profile.

```bash
npm run cli -- agent show --agent <name>
```

### agent run
Run one agent once with selected strategy.

Supported strategy names:
- `memo-heartbeat`
- `simple-scripted-transfer`
- `universal-defi`

```bash
npm run cli -- agent run --agent <name> --strategy <strategy>
```

### agent run-all
Run all active agents once.

```bash
npm run cli -- agent run-all
```

### agent stop
Mark an agent as stopped.

```bash
npm run cli -- agent stop --agent <name>
```

### agent logs
Show recent activity rows for one agent.

```bash
npm run cli -- agent logs --agent <name>
```

## 8) Monitoring Commands

### monitor overview
Concise operational summary per agent:
- agent id
- wallet
- SOL
- tracked SPL summary
- last action
- last signature
- policy mode
- status

```bash
npm run cli -- monitor overview
```

### monitor balances
Wallet SOL balances.

```bash
npm run cli -- monitor balances
```

### monitor txs
Recent transaction activity (from CLI activity store).

```bash
npm run cli -- monitor txs
```

### monitor agents
Agent runtime state rows.

```bash
npm run cli -- monitor agents
```

### monitor watch
Live-refresh monitor overview.

Options:
- `--interval <seconds>` refresh frequency (default `5`)
- `--iterations <n>` stop after `n` refreshes (`0` = infinite)

```bash
npm run cli -- monitor watch --interval 5
npm run cli -- monitor watch --interval 2 --iterations 10 --json
```

## 9) Demo Commands

### demo multi-agent-devnet
Runs existing multi-agent devnet scenario (reused, not duplicated).

```bash
npm run cli -- demo multi-agent-devnet
```

## 10) Audit / Config / Doctor

### audit
Show recent activity records.

```bash
npm run cli -- audit
npm run cli -- audit --limit 200
```

### config show
Print effective runtime config.

```bash
npm run cli -- config show
```

Also includes:

- `custodyModel`: local user custody mode for CLI-managed wallets
- `cliDataDir`: where the current install stores encrypted wallet state
- `walletKeySource`: `local-file` by default, or `env` when `PRKT_WALLET_MASTER_KEY` is supplied
- `policyExecutionModel`: high-level description of how policy gates agent actions

### doctor
Checks:
- cluster detection
- RPC connectivity
- custody model
- CLI data directory
- CLI data directory writability
- wallet key source
- policy execution model
- treasury key presence
- live mode flags

```bash
npm run cli -- doctor
```

## 11) Completion

Generate shell completion scripts:

```bash
npm run cli -- completion bash
npm run cli -- completion zsh
npm run cli -- completion powershell
```

Install examples:

Bash:
```bash
npm run cli -- completion bash > /etc/bash_completion.d/prkt
```

Zsh:
```bash
npm run cli -- completion zsh > ~/.zsh/completions/_prkt
```

PowerShell:
```powershell
npm run cli -- completion powershell | Out-File -FilePath $PROFILE.CurrentUserAllHosts -Append
```

## 12) Explorer Links

Commands that submit transactions print signatures. Devnet explorer format:

```text
https://explorer.solana.com/tx/<signature>?cluster=devnet
```

## 13) Persistent State Files

CLI state is intentionally lightweight and local to the operator machine. The default custody model is one local encryption key per user install:

- Windows: `%APPDATA%/PRKT/`
- macOS: `~/Library/Application Support/PRKT/`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/prkt/`
- Override for automation/tests: `PRKT_CLI_HOME`

Files stored there:

- `cli-wallets.json`: managed wallet registry
- `cli-agents.json`: agent metadata/status registry
- `cli-activity.json`: activity/audit records
- `platform-wallet-master.key`: local platform encryption key when `PRKT_WALLET_MASTER_KEY` is unset

These files are used for monitoring/audit convenience and do not replace on-chain truth.

## 14) Architecture Mapping

- Wallet Core (`src/core`):
  - `wallet ...`
  - `token ...`
- Policy + Sandbox (`src/policy`):
  - `policy show`
  - `policy validate-intent`
- Agent Runner (`src/agent`):
  - `agent ...`
- Test dApp / Protocol Interaction (`src/demo`, `src/defi`, `src/scripts`):
  - `demo multi-agent-devnet`
  - `agent run --strategy universal-defi`

## 15) Example End-to-End Flows

### Flow A: Treasury bootstrap

```bash
npm run cli -- wallet create --name treasury
npm run cli -- wallet fund --name treasury --sol 2
npm run cli -- wallet balance --name treasury
```

### Flow B: Demo token setup

```bash
npm run cli -- token mint-demo --authority treasury --decimals 6 --amount 1000
```

### Flow C: Agent operation and monitoring

```bash
npm run cli -- agent list
npm run cli -- agent run --agent treasury --strategy memo-heartbeat
npm run cli -- monitor overview
npm run cli -- monitor txs
```

### Flow D: Policy inspection

```bash
npm run cli -- policy show --agent treasury
npm run cli -- policy validate-intent --agent treasury --intent-file ./intent.json
```

### Flow E: Provider preset management

```bash
npm run cli -- policy presets
npm run cli -- policy set-preset --agent treasury --preset guarded-live
npm run cli -- policy set-limits --agent treasury --allowed-close-destinations <wallet-pubkey>
npm run cli -- policy show --agent treasury
```

## 16) Troubleshooting

### `Wallet '<name>' not found`
Create the wallet first:
```bash
npm run cli -- wallet create --name <name>
```

### `Unknown wallet/agent '<name>'`
Verify with:
```bash
npm run cli -- wallet list
npm run cli -- agent list
```

### Airdrop failure on devnet
RPC faucet may be rate-limited. Retry, lower amount, or switch devnet endpoint.

### Live DeFi path not used
Check:
- `UNIVERSAL_DEFI_LIVE_FIRST=true`
- `ENABLE_LIVE_SWAP_PATH=true` for Jupiter
- `ENABLE_LIVE_RAYDIUM_LP=true` + valid `raydium_lp.devnet.json` for Raydium LP
- `KORA_MOCK_MODE=false` for non-mock relayer path

### `bigint: Failed to load bindings` warning
This is a known optional native binding warning from dependency stack; tests/CLI still run in pure JS mode.
