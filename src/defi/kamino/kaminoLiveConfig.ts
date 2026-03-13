import { existsSync, readFileSync } from "fs";
import path from "path";

import { PublicKey } from "@solana/web3.js";

import { getKaminoLiveConfigPath } from "../../config/env";

type SupportedKaminoCluster = "devnet" | "localnet" | "mainnet-beta";

export type KaminoLiveConfig = {
  actions: {
    borrowAmountRaw: bigint;
    depositAmountRaw: bigint;
  };
  borrowMint: string;
  cluster?: SupportedKaminoCluster;
  depositMint: string;
  marketAddress: string;
  programId: string;
};

export function loadKaminoLiveConfig(): KaminoLiveConfig {
  const configPath = path.resolve(process.cwd(), getKaminoLiveConfigPath());
  if (!existsSync(configPath)) {
    throw new Error(
      `Kamino live config not found at ${configPath}. Create kamino_live.json from kamino_live.example.json first.`
    );
  }

  const raw = readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<{
    actions: {
      borrowAmountRaw?: number | string;
      depositAmountRaw?: number | string;
    };
    borrowMint: string;
    cluster?: SupportedKaminoCluster;
    depositMint: string;
    marketAddress: string;
    programId: string;
  }>;

  return {
    actions: {
      borrowAmountRaw: parsePositiveBigInt(parsed.actions?.borrowAmountRaw, "actions.borrowAmountRaw"),
      depositAmountRaw: parsePositiveBigInt(
        parsed.actions?.depositAmountRaw,
        "actions.depositAmountRaw"
      )
    },
    borrowMint: parsePublicKey(parsed.borrowMint, "borrowMint"),
    cluster: parseOptionalCluster(parsed.cluster),
    depositMint: parsePublicKey(parsed.depositMint, "depositMint"),
    marketAddress: parsePublicKey(parsed.marketAddress, "marketAddress"),
    programId: parsePublicKey(parsed.programId, "programId")
  };
}

function parseOptionalCluster(value: unknown): SupportedKaminoCluster | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "devnet" || value === "localnet" || value === "mainnet-beta") {
    return value;
  }

  throw new Error("cluster must be one of 'devnet', 'localnet', or 'mainnet-beta'.");
}

function parsePositiveBigInt(value: unknown, field: string): bigint {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${field} must be a positive integer or digit string.`);
    }

    return BigInt(value);
  }

  if (typeof value === "string" && /^[0-9]+$/u.test(value)) {
    const parsed = BigInt(value);
    if (parsed <= 0n) {
      throw new Error(`${field} must be greater than zero.`);
    }

    return parsed;
  }

  throw new Error(`${field} must be a positive integer or digit string.`);
}

function parsePublicKey(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a base58 public key string.`);
  }

  return new PublicKey(value).toBase58();
}
