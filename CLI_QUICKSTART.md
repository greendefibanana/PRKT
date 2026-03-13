# PRKT CLI Quickstart

Fast path for judges and reviewers.

For the full end-to-end guide, see:
- [FULL_DOCUMENTATION.md](./FULL_DOCUMENTATION.md)

## 0) Prerequisites

- Node 18+
- `.env` configured for devnet
- configured `REMOTE_SIGNER_*` for production-style signing, or funded `AGENT_PRIVATE_KEY` for local devnet/demo use only

## 1) Install and sanity check

Published CLI:

```bash
npm install -g @prktsol/prkt
prkt --help
prkt init
prkt-devnet-matrix
```

From source:

```bash
npm install
npm run cli -- --help
npm run cli -- init
npm run demo:feature-matrix:devnet
```

## 1a) One-command devnet proof

Use the feature matrix when you need the fastest end-to-end devnet verification run.

```bash
npm run demo:feature-matrix:devnet
```

Published install:

```bash
prkt-devnet-matrix
```

## 2) Create wallets

```bash
npm run cli -- wallet create --name treasury
npm run cli -- wallet create --name agent-a
npm run cli -- wallet list
```

## 3) Fund treasury on devnet

```bash
npm run cli -- wallet fund --name treasury --sol 2
npm run cli -- wallet balance --name treasury
```

## 4) Mint demo SPL token

```bash
npm run cli -- token mint-demo --authority treasury --decimals 6 --amount 1000
```

## 5) Run agent action

```bash
npm run cli -- agent run --agent treasury --strategy memo-heartbeat
```

## 6) Run multi-agent devnet demo

```bash
npm run cli -- demo multi-agent-devnet
```

## 7) Monitor operations

```bash
npm run cli -- monitor overview
npm run cli -- monitor txs
npm run cli -- monitor watch --interval 5
```

## 8) Inspect policy

```bash
npm run cli -- policy show --agent treasury
```

Validate an intent file:

```bash
npm run cli -- policy validate-intent --agent treasury --intent-file ./intent.json
```

## 9) Doctor and config checks

```bash
npm run cli -- doctor
npm run cli -- config show
```

Published CLI equivalents:

```bash
prkt doctor
prkt config show
```

## 10) JSON mode for automation

```bash
npm run cli -- --json monitor overview
```

## Useful links

- Full CLI docs: [CLI.md](./CLI.md)
- Project overview: [README.md](./README.md)
