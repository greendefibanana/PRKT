# Bounty Evidence Log

Use this file during your final recorded demo run and fill every field.
Unfilled placeholders are not submission evidence.

Reference: `artifacts/grant-devnet-status.md` contains the current reviewer-safe status language and the latest verified devnet proof/session anchors from a passing run.

## Session Metadata

- Date (UTC):
- Operator:
- Git commit:
- RPC URL:
- Cluster:

## Preflight

- `npm run demo:rehearsal` status:
- `artifacts/demo-session.json` generated: yes/no

## Required Live Actions

### 1) Autonomous Agent Wallet Demo

- Command: `npm run demo:autonomous-agent-wallet:devnet`
- Wallet pubkey:
- Funding signature:
- Live protocol signature:
- SOL before:
- SOL after:
- mSOL before:
- mSOL after:
- Programmatic wallet generation observed: yes/no
- Emergency stop block observed: yes/no

### 2) Additional Live Protocol Interaction (Raydium LP or Kamino)

- Command:
- Protocol:
- Pool / market ID:
- Tx signature:
- On-chain confirm screenshot/link:

### 3) Security Guardrail Demo

- Command: `npm run simulate-attack`
- Expected blocked behavior observed: yes/no
- Key log line:

### 4) Multi-Agent Safety Controls

- Command: `npm run stress:agents`
- Rate-limit blocks observed: yes/no
- Circuit-breaker blocks observed: yes/no
- Key log lines:

## Optional

- `npm run wallet:devnet` direct wallet demo status:
- `npm run wallet:gasless` mode (`LIVE`/`SIMULATED`):
- Tx signature:
- Notes:

## Submission Links

- Repo URL:
- README URL:
- Deep dive doc/video URL:
- Devnet explorer links:
