# Compatibility Matrix

## Cluster Support

| Cluster | Status | Notes |
|---------|--------|-------|
| Devnet | Supported | Default. All live demos and tests target devnet |
| Testnet | Untested | Should work in core paths but not validated |
| Mainnet | Blocked | Requires completion of mainnet deployment gate items |
| Localnet | Partial | Wallet core works; protocol adapters require live RPC |

## Protocol Support

| Protocol | Capability | Live Status | Simulated Status |
|----------|-----------|-------------|-----------------|
| Jupiter | Trade (swap) | Devnet live | Memo fallback |
| Orca | LP (Whirlpools) | Devnet live via public pool | Not implemented |
| Raydium | LP (add liquidity) | Devnet live | Memo fallback |
| Raydium | Yield | Not implemented | Memo fallback |
| Marinade | Staking | Devnet live | Memo fallback |
| Kamino | Lending / Borrowing | Devnet live via config | Memo fallback |
| Kamino | Yield | Not implemented | Memo fallback |

## Command Modes

| Command | Mode | Cluster |
|---------|------|---------|
| `npm run demo:autonomous-agent-wallet:devnet` | `LIVE` | Devnet |
| `npm run wallet:devnet` | `LIVE` | Devnet |
| `npm run defi:stake:devnet -- 0.15` | `LIVE` | Devnet |
| `npm run defi:orca:devnet -- 0.05` | `LIVE` | Devnet |
| `npm run defi:lp:devnet` | `LIVE` | Devnet |
| `npm run defi:kamino:devnet -- deposit` | `LIVE` | Devnet |
| `npm run defi:kamino:devnet -- borrow` | `LIVE` | Devnet |
| `npm run demo:multi-agent:devnet` | `LIVE` | Devnet |
| `npm run simulate-attack` | `LIVE` | Devnet |
| `npm run stress:agents` | `LIVE` | Devnet |
| `npm run wallet:gasless` | `LIVE` (if `KORA_MOCK_MODE=false`) | Devnet |
| `npm run defi:universal` | `SIMULATED` | Any |
| `npm run agent:defi:universal` | `SIMULATED` | Any |
| `npm run defi:borrow` | `SIMULATED` | Any |
| `npm run defi:all` | `SIMULATED` | Any |
| `npm run defi:lp` | `SIMULATED` | Any |
| `npm run defi:stake` | `SIMULATED` | Any |
| `npm run defi:yield` | `SIMULATED` | Any |
| `npm run trade:simulate` | `SIMULATED` | Any |

## Runtime Requirements

| Requirement | Version |
|-------------|---------|
| Node.js | >= 20.x |
| npm | >= 9.x |
| TypeScript | 5.9.x (dev dependency) |
| OS | Windows, macOS, Linux |

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@solana/web3.js` | ^1.98.4 | Solana RPC, transactions |
| `@solana/spl-token` | ^0.4.14 | SPL token operations |
| `@raydium-io/raydium-sdk-v2` | ^0.1.95-alpha | Raydium LP instructions |
| `@kamino-finance/klend-sdk` | ^7.3.20 | Kamino lending / borrowing instructions |
| `@marinade.finance/marinade-ts-sdk` | ^5.0.18 | Marinade staking instructions |
| `@orca-so/whirlpools-sdk` | ^0.20.0 | Orca Whirlpool LP instructions |
| `@orca-so/common-sdk` | ^0.7.0 | Orca transaction helpers |
| `solana-agent-kit` | ^1.4.9 | Agent toolkit integration |
| `commander` | ^12.1.0 | CLI framework |
| `dotenv` | ^16.6.1 | Environment config |
| `chalk` | ^4.1.2 | Terminal colors |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SOLANA_RPC_URL` | No | `https://api.devnet.solana.com` | Primary RPC endpoint |
| `SOLANA_RPC_FALLBACK_URL` | No | none | Failover RPC endpoint |
| `AGENT_PRIVATE_KEY` | Devnet only | `[]` | 64-integer JSON array (devnet/demo) |
| `DEVNET_TREASURY_PRIVATE_KEY` | No | `[]` | Optional funded devnet treasury for generated wallet top-ups |
| `REMOTE_SIGNER_URL` | Production | none | Remote signer HTTPS endpoint |
| `REMOTE_SIGNER_BEARER_TOKEN` | Production | none | Bearer auth token |
| `REMOTE_SIGNER_PUBKEY` | Production | none | Signer public key |
| `USDC_MINT` | No | devnet USDC | Token mint address |
| `KORA_RPC_URL` | No | `https://kora.devnet.lazorkit.com` | Kora gasless RPC |
| `KORA_MOCK_MODE` | No | `true` | Mock gasless signing |
| `JUPITER_API_BASE_URL` | No | `https://lite-api.jup.ag` | Jupiter API |
| `ENABLE_LIVE_SWAP_PATH` | No | `false` | Enable live Jupiter swaps |
| `ENABLE_LIVE_RAYDIUM_LP` | No | `false` | Enable live Raydium LP |
| `ENABLE_LIVE_KAMINO` | No | `false` | Enable live Kamino lending / borrowing |
| `ENABLE_LIVE_MARINADE` | No | `false` | Enable live Marinade staking |
| `KAMINO_LIVE_CONFIG_PATH` | No | `kamino_live.json` | Path to Kamino live config |
| `PRKT_AGENT_NAME` | No | script-specific default | Persistent agent/wallet name for autonomous and live DeFi scripts |
| `PRKT_OWNER_ID` | No | none | Optional owner id stored on auto-provisioned agents |
| `PRKT_WALLET_MASTER_KEY` | Recommended for live | local generated file fallback | 32-byte base64 or 64-char hex key used to decrypt managed agent wallets autonomously |
| `UNIVERSAL_DEFI_LIVE_FIRST` | No | `true` | Try live paths before fallback |
| `EXTRA_WHITELISTED_PROGRAMS` | No | none | Comma-separated program IDs |
| `POLICY_SESSION_TTL_MINUTES` | No | `60` | Session TTL (1-1440) |
| `POLICY_EMERGENCY_LOCK` | No | none | Set `true` to engage kill switch |
| `POLICY_EMERGENCY_LOCK_PATH` | No | `./emergency_lock.json` | Path to lock file |
| `POLICY_EMERGENCY_COMMAND_PATH` | No | `./emergency_command.json` | Path to signed command |
| `POLICY_EMERGENCY_ADMIN_SECRET` | No | none | HMAC secret for signed commands |
| `POLICY_EMERGENCY_MAX_AGE_SECONDS` | No | `600` | Max age for signed commands |
