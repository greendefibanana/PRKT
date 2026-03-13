import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import { Keypair } from "@solana/web3.js";

import type { StoredWalletRecord } from "../types";
import { WalletManager } from "../../core/wallet/WalletManager";
import {
  createRecoveryPackage,
  decryptSecretKeyForPlatform,
  decryptSecretKeyWithRecovery,
  encryptSecretKeyForPlatform
} from "./walletCrypto";
import { resolveCliDataPath } from "./storagePaths";

type WalletRegistryFile = {
  wallets: StoredWalletRecord[];
};

export type WalletProvisionResult = {
  created: boolean;
  record: StoredWalletRecord;
  recoveryKey: string | null;
};

export class WalletRegistry {
  list(): StoredWalletRecord[] {
    return this.read().wallets.slice().sort((a, b) => a.name.localeCompare(b.name));
  }

  find(name: string): StoredWalletRecord | undefined {
    return this.read().wallets.find((wallet) => wallet.name === name);
  }

  create(name: string): WalletProvisionResult {
    const existing = this.find(name);
    if (existing) {
      throw new Error(`Wallet '${name}' already exists.`);
    }

    return this.provision({
      name,
      secretKey: Keypair.generate().secretKey
    });
  }

  toWalletManager(name: string): WalletManager {
    const record = this.requireRecord(name);
    return WalletManager.fromSecretKey(this.resolveSecretKey(record), "generated");
  }

  ensureFromEnv(name: string): WalletProvisionResult {
    const existing = this.find(name);
    if (existing) {
      return {
        created: false,
        record: existing,
        recoveryKey: null
      };
    }

    const fromEnv = WalletManager.loadFromEnv();
    return this.provision({
      name,
      secretKey: fromEnv.payer.secretKey
    });
  }

  exportSecretKeyWithRecovery(input: { name: string; recoveryKey: string }): Uint8Array {
    const record = this.requireRecord(input.name);
    if (!record.recoveryPackage) {
      throw new Error(`Wallet '${input.name}' does not have a recovery package.`);
    }

    return decryptSecretKeyWithRecovery({
      recoveryKey: input.recoveryKey,
      recoveryPackage: record.recoveryPackage
    });
  }

  private provision(input: {
    name: string;
    secretKey: Uint8Array;
  }): WalletProvisionResult {
    const wallet = WalletManager.fromSecretKey(input.secretKey, "generated");
    const recovery = createRecoveryPackage(input.secretKey);
    const record: StoredWalletRecord = {
      createdAtIso: new Date().toISOString(),
      encryptedSecretKey: encryptSecretKeyForPlatform(input.secretKey),
      name: input.name,
      publicKey: wallet.publicKey.toBase58(),
      recoveryPackage: recovery.recoveryPackage,
      version: 2
    };

    const registry = this.read();
    registry.wallets.push(record);
    this.write(registry);

    return {
      created: true,
      record,
      recoveryKey: recovery.recoveryKey
    };
  }

  private requireRecord(name: string): StoredWalletRecord {
    const registry = this.read();
    const record = registry.wallets.find((wallet) => wallet.name === name);
    if (!record) {
      throw new Error(`Wallet '${name}' not found.`);
    }

    const migrated = this.maybeMigrateLegacyRecord(registry, record);
    return migrated ?? record;
  }

  private read(): WalletRegistryFile {
    const registryPath = resolveCliDataPath("cli-wallets.json");
    if (!existsSync(registryPath)) {
      return {
        wallets: []
      };
    }

    const raw = readFileSync(registryPath, "utf8");
    const parsed = JSON.parse(raw) as WalletRegistryFile;
    return {
      wallets: (parsed.wallets ?? []).map((wallet) => this.normalize(wallet))
    };
  }

  private write(payload: WalletRegistryFile): void {
    const registryPath = resolveCliDataPath("cli-wallets.json");
    mkdirSync(path.dirname(registryPath), { recursive: true, mode: 0o700 });
    writeFileSync(registryPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  }

  private maybeMigrateLegacyRecord(
    registry: WalletRegistryFile,
    record: StoredWalletRecord
  ): StoredWalletRecord | null {
    if (!record.secretKey || record.encryptedSecretKey) {
      return null;
    }

    const secretKey = Uint8Array.from(record.secretKey);
    const recovery = createRecoveryPackage(secretKey);
    const migrated: StoredWalletRecord = {
      createdAtIso: record.createdAtIso,
      encryptedSecretKey: encryptSecretKeyForPlatform(secretKey),
      name: record.name,
      publicKey: record.publicKey,
      recoveryPackage: recovery.recoveryPackage,
      version: 2
    };

    const index = registry.wallets.findIndex((entry) => entry.name === record.name);
    registry.wallets[index] = migrated;
    this.write(registry);

    return migrated;
  }

  private normalize(wallet: StoredWalletRecord): StoredWalletRecord {
    return {
      ...wallet,
      version: wallet.version ?? (wallet.encryptedSecretKey ? 2 : 1)
    };
  }

  private resolveSecretKey(record: StoredWalletRecord): Uint8Array {
    if (record.encryptedSecretKey) {
      return decryptSecretKeyForPlatform(record.encryptedSecretKey);
    }

    if (record.secretKey) {
      return Uint8Array.from(record.secretKey);
    }

    throw new Error(`Wallet '${record.name}' does not contain recoverable key material.`);
  }
}

export function generateTemporaryWalletName(): string {
  return `wallet-${Keypair.generate().publicKey.toBase58().slice(0, 8)}`;
}
