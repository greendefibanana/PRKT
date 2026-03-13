import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

import type { RecoveryPackage, WalletCiphertext } from "../types";
import { resolveCliDataPath } from "./storagePaths";

const MASTER_KEY_ENV = "PRKT_WALLET_MASTER_KEY";
const KEY_BYTES = 32;

type ParsedKey = {
  key: Buffer;
  source: "env" | "local-file";
};

export function encryptSecretKeyForPlatform(secretKey: Uint8Array): WalletCiphertext {
  const { key } = resolvePlatformMasterKey({ allowCreate: true });
  return encryptBytes(secretKey, key);
}

export function decryptSecretKeyForPlatform(payload: WalletCiphertext): Uint8Array {
  const { key } = resolvePlatformMasterKey({ allowCreate: false });
  return decryptBytes(payload, key);
}

export function createRecoveryPackage(secretKey: Uint8Array): {
  recoveryKey: string;
  recoveryPackage: RecoveryPackage;
} {
  const recoveryKey = encodeRecoveryKey(randomBytes(KEY_BYTES));
  const salt = randomBytes(16);
  const key = scryptSync(recoveryKey, salt, KEY_BYTES);
  const encrypted = encryptBytes(secretKey, key);

  return {
    recoveryKey,
    recoveryPackage: {
      algorithm: "scrypt-aes-256-gcm",
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      kdf: "scrypt",
      salt: salt.toString("base64"),
      tag: encrypted.tag
    }
  };
}

export function decryptSecretKeyWithRecovery(input: {
  recoveryKey: string;
  recoveryPackage: RecoveryPackage;
}): Uint8Array {
  const key = scryptSync(input.recoveryKey, Buffer.from(input.recoveryPackage.salt, "base64"), KEY_BYTES);
  return decryptBytes(
    {
      algorithm: "aes-256-gcm",
      ciphertext: input.recoveryPackage.ciphertext,
      iv: input.recoveryPackage.iv,
      tag: input.recoveryPackage.tag
    },
    key
  );
}

export function getPlatformMasterKeySource(): "env" | "local-file" {
  return resolvePlatformMasterKey({ allowCreate: true }).source;
}

function resolvePlatformMasterKey(input: { allowCreate: boolean }): ParsedKey {
  const masterKeyPath = resolveCliDataPath("platform-wallet-master.key");
  const envValue = process.env[MASTER_KEY_ENV]?.trim();
  if (envValue) {
    return {
      key: parseConfiguredKey(envValue),
      source: "env"
    };
  }

  if (existsSync(masterKeyPath)) {
    return {
      key: readStoredKey(masterKeyPath),
      source: "local-file"
    };
  }

  if (!input.allowCreate) {
    throw new Error(
      `Wallet master key is not configured. Set ${MASTER_KEY_ENV} or create ${masterKeyPath}.`
    );
  }

  const generated = randomBytes(KEY_BYTES);
  mkdirSync(path.dirname(masterKeyPath), { recursive: true, mode: 0o700 });
  writeFileSync(masterKeyPath, generated.toString("base64"), { mode: 0o600 });
  return {
    key: generated,
    source: "local-file"
  };
}

function parseConfiguredKey(value: string): Buffer {
  if (/^[0-9a-f]{64}$/iu.test(value)) {
    return Buffer.from(value, "hex");
  }

  const base64 = Buffer.from(value, "base64");
  if (base64.length === KEY_BYTES) {
    return base64;
  }

  throw new Error(
    `${MASTER_KEY_ENV} must be a 32-byte key encoded as base64 or 64 hex characters.`
  );
}

function readStoredKey(filePath: string): Buffer {
  const raw = readFileSync(filePath, "utf8").trim();
  const parsed = Buffer.from(raw, "base64");
  if (parsed.length !== KEY_BYTES) {
    throw new Error(`Stored wallet master key at ${filePath} is invalid.`);
  }

  return parsed;
}

function encryptBytes(value: Uint8Array, key: Buffer): WalletCiphertext {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(value)), cipher.final()]);

  return {
    algorithm: "aes-256-gcm",
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64")
  };
}

function decryptBytes(payload: WalletCiphertext, key: Buffer): Uint8Array {
  const decipher = createDecipheriv(
    payload.algorithm,
    key,
    Buffer.from(payload.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final()
  ]);

  return Uint8Array.from(plaintext);
}

function encodeRecoveryKey(bytes: Buffer): string {
  return `prkt_recovery_${bytes.toString("base64url")}`;
}
