import dotenv from "dotenv";
import { PublicKey } from "@solana/web3.js";

dotenv.config();

const PRIVATE_KEY_ENV = "AGENT_PRIVATE_KEY";
const RPC_ENV = "SOLANA_RPC_URL";
const RPC_FALLBACK_ENV = "SOLANA_RPC_FALLBACK_URL";
const KORA_RPC_ENV = "KORA_RPC_URL";
const KORA_MOCK_MODE_ENV = "KORA_MOCK_MODE";
const JUPITER_API_BASE_URL_ENV = "JUPITER_API_BASE_URL";
const ENABLE_LIVE_SWAP_PATH_ENV = "ENABLE_LIVE_SWAP_PATH";
const ENABLE_LIVE_RAYDIUM_LP_ENV = "ENABLE_LIVE_RAYDIUM_LP";
const ENABLE_LIVE_KAMINO_ENV = "ENABLE_LIVE_KAMINO";
const ENABLE_LIVE_MARINADE_ENV = "ENABLE_LIVE_MARINADE";
const RAYDIUM_LP_CONFIG_PATH_ENV = "RAYDIUM_LP_CONFIG_PATH";
const KAMINO_LIVE_CONFIG_PATH_ENV = "KAMINO_LIVE_CONFIG_PATH";
const UNIVERSAL_DEFI_LIVE_FIRST_ENV = "UNIVERSAL_DEFI_LIVE_FIRST";
const USDC_MINT_ENV = "USDC_MINT";
const EXTRA_WHITELISTED_PROGRAMS_ENV = "EXTRA_WHITELISTED_PROGRAMS";
const POLICY_SESSION_TTL_MINUTES_ENV = "POLICY_SESSION_TTL_MINUTES";
const DEVNET_TREASURY_PRIVATE_KEY_ENV = "DEVNET_TREASURY_PRIVATE_KEY";
const REMOTE_SIGNER_URL_ENV = "REMOTE_SIGNER_URL";
const REMOTE_SIGNER_BEARER_TOKEN_ENV = "REMOTE_SIGNER_BEARER_TOKEN";
const REMOTE_SIGNER_PUBKEY_ENV = "REMOTE_SIGNER_PUBKEY";
const ZK_COMPRESSION_API_URL_ENV = "ZK_COMPRESSION_API_URL";
const ZK_PROVER_URL_ENV = "ZK_PROVER_URL";
const ONCHAIN_POLICY_GUARD_PROGRAM_ID_ENV = "ONCHAIN_POLICY_GUARD_PROGRAM_ID";
const IMPLEMENTATION_PATH_ENV = "IMPLEMENTATION_PATH";
const NEON_BROADCAST_ENABLED_ENV = "NEON_BROADCAST_ENABLED";
const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

export class EnvConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvConfigError";
  }
}

function parseSecretKey(rawValue: string): Uint8Array {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new EnvConfigError(`${PRIVATE_KEY_ENV} must be valid JSON.`);
  }

  if (!Array.isArray(parsed) || !parsed.every((value) => Number.isInteger(value))) {
    throw new EnvConfigError(`${PRIVATE_KEY_ENV} must be a JSON array of integers.`);
  }

  if (parsed.length !== 64) {
    throw new EnvConfigError(`${PRIVATE_KEY_ENV} must contain exactly 64 integers.`);
  }

  const byteValues = parsed as number[];
  if (byteValues.some((value) => value < 0 || value > 255)) {
    throw new EnvConfigError(`${PRIVATE_KEY_ENV} values must be between 0 and 255.`);
  }

  return Uint8Array.from(byteValues);
}

function getOptionalSecretKeyFromEnv(envName: string): Uint8Array | null {
  const rawValue = process.env[envName];
  if (!rawValue) {
    return null;
  }

  const trimmed = rawValue.trim();
  if (trimmed.length === 0 || trimmed === "[]") {
    return null;
  }

  return parseSecretKey(trimmed);
}

export function getOptionalSecretKey(): Uint8Array | null {
  return getOptionalSecretKeyFromEnv(PRIVATE_KEY_ENV);
}

export function getOptionalDevnetTreasurySecretKey(): Uint8Array | null {
  return getOptionalSecretKeyFromEnv(DEVNET_TREASURY_PRIVATE_KEY_ENV);
}

export function getRpcUrl(): string {
  const rpcUrl = process.env[RPC_ENV]?.trim();
  return rpcUrl && rpcUrl.length > 0 ? rpcUrl : "https://api.devnet.solana.com";
}

export function getRpcFallbackUrl(): string | null {
  const fallbackUrl = process.env[RPC_FALLBACK_ENV]?.trim();
  return fallbackUrl && fallbackUrl.length > 0 ? fallbackUrl : null;
}

export function getZkCompressionApiUrl(): string | null {
  const value = process.env[ZK_COMPRESSION_API_URL_ENV]?.trim();
  return value && value.length > 0 ? value : null;
}

export function getZkProverUrl(): string | null {
  const value = process.env[ZK_PROVER_URL_ENV]?.trim();
  return value && value.length > 0 ? value : null;
}

export function getOnchainPolicyGuardProgramId(): string | null {
  const value = process.env[ONCHAIN_POLICY_GUARD_PROGRAM_ID_ENV]?.trim();
  return value && value.length > 0 ? value : null;
}

export function getImplementationPath(): string {
  const value = process.env[IMPLEMENTATION_PATH_ENV]?.trim();
  return value && value.length > 0 ? value : "strict_live";
}

export function isDefensibleDevnetDemoMode(): boolean {
  return getImplementationPath() === "defensible_devnet_demo";
}

export function isNeonBroadcastEnabled(): boolean {
  const rawValue = process.env[NEON_BROADCAST_ENABLED_ENV]?.trim().toLowerCase();
  if (!rawValue) {
    return false;
  }

  return rawValue === "true" || rawValue === "1";
}

export function getKoraRpcUrl(): string {
  const koraRpcUrl = process.env[KORA_RPC_ENV]?.trim();
  return koraRpcUrl && koraRpcUrl.length > 0
    ? koraRpcUrl
    : "https://kora.devnet.lazorkit.com";
}

export function isKoraMockMode(): boolean {
  const rawValue = process.env[KORA_MOCK_MODE_ENV]?.trim().toLowerCase();
  if (!rawValue) {
    return true;
  }

  return rawValue !== "false" && rawValue !== "0";
}

export function getJupiterApiBaseUrl(): string {
  const value = process.env[JUPITER_API_BASE_URL_ENV]?.trim();
  return value && value.length > 0 ? value : "https://lite-api.jup.ag";
}

export function getRaydiumLpConfigPath(): string {
  const value = process.env[RAYDIUM_LP_CONFIG_PATH_ENV]?.trim();
  return value && value.length > 0 ? value : "raydium_lp.devnet.json";
}

export function getKaminoLiveConfigPath(): string {
  const value = process.env[KAMINO_LIVE_CONFIG_PATH_ENV]?.trim();
  return value && value.length > 0 ? value : "kamino_live.json";
}

export function isLiveSwapPathEnabled(): boolean {
  const rawValue = process.env[ENABLE_LIVE_SWAP_PATH_ENV]?.trim().toLowerCase();
  if (!rawValue) {
    return false;
  }

  return rawValue === "true" || rawValue === "1";
}

export function isLiveRaydiumLpEnabled(): boolean {
  const rawValue = process.env[ENABLE_LIVE_RAYDIUM_LP_ENV]?.trim().toLowerCase();
  if (!rawValue) {
    return false;
  }

  return rawValue === "true" || rawValue === "1";
}

export function isLiveKaminoEnabled(): boolean {
  const rawValue = process.env[ENABLE_LIVE_KAMINO_ENV]?.trim().toLowerCase();
  if (!rawValue) {
    return false;
  }

  return rawValue === "true" || rawValue === "1";
}

export function isLiveMarinadeEnabled(): boolean {
  const rawValue = process.env[ENABLE_LIVE_MARINADE_ENV]?.trim().toLowerCase();
  if (!rawValue) {
    return false;
  }

  return rawValue === "true" || rawValue === "1";
}

export function isUniversalDeFiLiveFirstEnabled(): boolean {
  const rawValue = process.env[UNIVERSAL_DEFI_LIVE_FIRST_ENV]?.trim().toLowerCase();
  if (!rawValue) {
    return true;
  }

  return rawValue !== "false" && rawValue !== "0";
}

export function getUsdcMintAddress(): string {
  const value = process.env[USDC_MINT_ENV]?.trim();
  return value && value.length > 0
    ? value
    : DEVNET_USDC_MINT;
}

export function getExtraWhitelistedPrograms(): string[] {
  const value = process.env[EXTRA_WHITELISTED_PROGRAMS_ENV]?.trim();
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function getPolicySessionTtlMinutes(): number {
  const rawValue = process.env[POLICY_SESSION_TTL_MINUTES_ENV]?.trim();
  if (!rawValue) {
    return 60;
  }

  const ttl = Number(rawValue);
  if (!Number.isInteger(ttl) || ttl <= 0 || ttl > 24 * 60) {
    throw new EnvConfigError(
      `${POLICY_SESSION_TTL_MINUTES_ENV} must be a positive integer between 1 and 1440.`
    );
  }

  return ttl;
}

export function getRemoteSignerConfig(): {
  bearerToken: string;
  publicKey: PublicKey;
  url: string;
} | null {
  const url = process.env[REMOTE_SIGNER_URL_ENV]?.trim();
  const bearerToken = process.env[REMOTE_SIGNER_BEARER_TOKEN_ENV]?.trim();
  const publicKeyValue = process.env[REMOTE_SIGNER_PUBKEY_ENV]?.trim();

  const configuredCount = [url, bearerToken, publicKeyValue].filter(
    (value) => value && value.length > 0
  ).length;
  if (configuredCount === 0) {
    return null;
  }

  if (configuredCount !== 3 || !url || !bearerToken || !publicKeyValue) {
    throw new EnvConfigError(
      `${REMOTE_SIGNER_URL_ENV}, ${REMOTE_SIGNER_BEARER_TOKEN_ENV}, and ${REMOTE_SIGNER_PUBKEY_ENV} must all be configured together.`
    );
  }

  let publicKey: PublicKey;
  try {
    publicKey = new PublicKey(publicKeyValue);
  } catch {
    throw new EnvConfigError(`${REMOTE_SIGNER_PUBKEY_ENV} must be a valid Solana public key.`);
  }

  return {
    bearerToken,
    publicKey,
    url
  };
}

export function detectClusterFromRpcUrl(rpcUrl: string): "mainnet-beta" | "devnet" | "testnet" | "localnet" | "unknown" {
  const normalized = rpcUrl.trim().toLowerCase();
  if (
    normalized.includes("localhost") ||
    normalized.includes("127.0.0.1") ||
    normalized.includes("0.0.0.0")
  ) {
    return "localnet";
  }
  if (normalized.includes("devnet")) {
    return "devnet";
  }
  if (normalized.includes("testnet")) {
    return "testnet";
  }
  if (normalized.includes("mainnet")) {
    return "mainnet-beta";
  }

  return "unknown";
}

export function assertMintMatchesRpcCluster(input: {
  mintAddress: string;
  mintName: string;
  rpcUrl: string;
}): void {
  const cluster = detectClusterFromRpcUrl(input.rpcUrl);
  if (cluster === "unknown" || cluster === "localnet" || cluster === "testnet") {
    return;
  }

  const mint = input.mintAddress.trim();
  if (cluster === "devnet" && mint === MAINNET_USDC_MINT) {
    throw new EnvConfigError(
      `${input.mintName} is set to the mainnet mint (${MAINNET_USDC_MINT}) while RPC is devnet (${input.rpcUrl}). Set USDC_MINT to a devnet mint such as ${DEVNET_USDC_MINT}.`
    );
  }

  if (cluster === "mainnet-beta" && mint === DEVNET_USDC_MINT) {
    throw new EnvConfigError(
      `${input.mintName} is set to the devnet mint (${DEVNET_USDC_MINT}) while RPC is mainnet (${input.rpcUrl}). Set USDC_MINT to the mainnet mint ${MAINNET_USDC_MINT}.`
    );
  }
}

export function redactSecretForLogs(): string {
  return `[REDACTED:${PRIVATE_KEY_ENV}]`;
}
