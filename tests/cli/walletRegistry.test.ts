import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import os from "os";

import { WalletRegistry } from "../../src/cli/services/walletRegistry";
import { getCliHomeEnvName } from "../../src/cli/services/storagePaths";

const CLI_HOME_ENV = getCliHomeEnvName();
const ARTIFACTS_DIR = path.join(os.tmpdir(), "prkt-wallet-registry-tests");
const REGISTRY_PATH = path.resolve(ARTIFACTS_DIR, "cli-wallets.json");
const MASTER_KEY_PATH = path.resolve(ARTIFACTS_DIR, "platform-wallet-master.key");

describe("WalletRegistry", () => {
  beforeEach(() => {
    process.env[CLI_HOME_ENV] = ARTIFACTS_DIR;
    rmSync(ARTIFACTS_DIR, { force: true, recursive: true });
    mkdirSync(ARTIFACTS_DIR, { recursive: true });
    writeFileSync(REGISTRY_PATH, JSON.stringify({ wallets: [] }, null, 2));
  });

  afterAll(() => {
    delete process.env[CLI_HOME_ENV];
    if (existsSync(REGISTRY_PATH)) {
      rmSync(REGISTRY_PATH, { force: true });
    }
    if (existsSync(MASTER_KEY_PATH)) {
      rmSync(MASTER_KEY_PATH, { force: true });
    }
    if (existsSync(ARTIFACTS_DIR)) {
      rmSync(ARTIFACTS_DIR, { force: true, recursive: true });
    }
  });

  it("creates and reads wallet records", () => {
    const registry = new WalletRegistry();
    const created = registry.create("cli-test-wallet");
    expect(created.record.name).toBe("cli-test-wallet");
    expect(typeof created.recoveryKey).toBe("string");

    const fetched = registry.find("cli-test-wallet");
    expect(fetched?.publicKey).toBe(created.record.publicKey);
    expect(fetched?.encryptedSecretKey).toBeDefined();
    expect(fetched?.recoveryPackage).toBeDefined();
  });

  it("exports a wallet secret key with the recovery key", () => {
    const registry = new WalletRegistry();
    const created = registry.create("cli-recovery-wallet");
    const exported = registry.exportSecretKeyWithRecovery({
      name: "cli-recovery-wallet",
      recoveryKey: created.recoveryKey!
    });

    expect(Array.from(exported)).toHaveLength(64);
    expect(registry.toWalletManager("cli-recovery-wallet").publicKey.toBase58()).toBe(
      created.record.publicKey
    );
  });

  it("lists wallets sorted by name", () => {
    const registry = new WalletRegistry();
    registry.create("b-wallet");
    registry.create("a-wallet");
    const names = registry.list().map((entry) => entry.name);
    expect(names).toEqual(["a-wallet", "b-wallet"]);
  });
});
