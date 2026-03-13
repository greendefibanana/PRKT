# PRKT Devnet Feature Matrix

Generated: 2026-03-13T17:44:27.592Z
Cluster: devnet
Overall: PASS (39 ok, 0 warn, 3 skip, 0 fail)

## Entities

- Wallet: matrix-wallet-23549042
- Agent: matrix-agent-23549042
- Owner: matrix-owner-23549042
- Gasless agent: matrix-gasless-23549042

## Advanced Devnet Proof Path

- Session ID: 49dd8cdf-e52a-4e06-b0bc-5135f1944de8
- Session close signature: 4kK9BGFspR1VT5zyChiAe13G7YnUhLtfW58z4VziXK3s4RQFea65ddMrRzV9BQQE3KmP581TrYpFwFzA4t4JVPdz
- Policy account signature: 5QxX18MyX8WLMspMittETf3jBxmyNw3h4rxa2LrAu9LY9vCMGXFjTg5NRWs99T57okYHf5FAiw6Lsx8R51kTHJf4
- Proof signature: 5K6JgndWx3mwjXjrEZDLhJDfmq8czwmH3oXsGTCupMQAHpSWT6qGnKGdDFUELAZQFrU1g2FMrtgDYBwvXbGMNto5
- Commitment: 6acdb8fbceb174cc4648f5b6709eeb2517e8bbf17d00ffb1420dfb910626ce86

## Step Results

| Category | Step | Status | Detail |
| --- | --- | --- | --- |
| preflight | cluster | OK | https://devnet.helius-rpc.com/?api-key=bd340d93-b7d3-4ac3-9c55-f861224149f2 |
| preflight | cli-home | OK | C:\Users\ezevi\Documents\PRKT\.prkt-devnet-matrix |
| cli | init | OK | C:\Users\ezevi\Documents\PRKT\.prkt-devnet-matrix |
| cli | config-show | OK | cluster=devnet |
| cli | doctor | OK | 11 checks |
| wallet | create | OK | 5LW1QxEnJgY4Wn7D22yEbqrJwBDGCqYJT2zsvxCqq1A3 |
| wallet | list | OK | listed wallets |
| wallet | show | OK | matrix-wallet-23549042 |
| wallet | fund | OK | 0.4 SOL requested |
| wallet | balance | OK | matrix-wallet-23549042 |
| token | mint-demo | OK | 9fn7kgx6SuiiZNZBT1Ta4fjhBENfXY26qNq1jpHqv3Ru |
| token | create-ata-wallet | OK | wallet ATA ensured |
| token | balance-spl-wallet | OK | 9fn7kgx6SuiiZNZBT1Ta4fjhBENfXY26qNq1jpHqv3Ru |
| agent | create | OK | ETRVg7zueeBnBrkxK1Aj57taBL41xty2zHaCjahR4uiz |
| agent | list | OK | listed agents |
| agent | show | OK | matrix-agent-23549042 |
| agent | fund | OK | 0.2 SOL requested |
| agent | balance | OK | matrix-agent-23549042 |
| token | create-ata-agent | OK | agent ATA ensured |
| wallet | transfer-sol | OK | to ETRVg7zueeBnBrkxK1Aj57taBL41xty2zHaCjahR4uiz |
| token | transfer-spl | OK | mint 9fn7kgx6SuiiZNZBT1Ta4fjhBENfXY26qNq1jpHqv3Ru |
| policy | presets | OK | listed presets |
| policy | show | OK | matrix-agent-23549042 |
| policy | set-preset-live | OK | guarded-live |
| policy | set-preset-default | OK | auto-devnet-safe |
| policy | set-limits | OK | temporary overrides applied |
| policy | validate-intent | OK | intent-1773423732949.json |
| policy | clear-overrides | OK | overrides cleared |
| agent | run | OK | memo-heartbeat |
| agent | logs | OK | matrix-agent-23549042 |
| monitor | views | OK | overview/balances/txs/agents |
| audit | audit | OK | limit 50 |
| advanced | memo-proof-compression-session | OK | 5K6JgndWx3mwjXjrEZDLhJDfmq8czwmH3oXsGTCupMQAHpSWT6qGnKGdDFUELAZQFrU1g2FMrtgDYBwvXbGMNto5 |
| advanced | cli-verification | OK | verify-session + verify-tx |
| gasless | kora-memo | OK | command completed |
| gasless | kora-mode | OK | mock |
| security | simulate-attack | OK | command completed |
| defi | defi-suite-simulated | OK | command completed |
| demo | stress-agents | SKIP | set PRKT_DEVNET_MATRIX_INCLUDE_STRESS=1 to run stress and multi-agent demos |
| custody | sensitive-exports | SKIP | set PRKT_DEVNET_MATRIX_INCLUDE_EXPORTS=1 to exercise secret export commands |
| live | protocol-demos | SKIP | set PRKT_DEVNET_MATRIX_INCLUDE_PROTOCOL_LIVE=1 to attempt live protocol demos |
| agent | stop | OK | matrix-agent-23549042 |
