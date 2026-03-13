import { mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

import { loadKaminoLiveConfig } from "../../src/defi/kamino/kaminoLiveConfig";

describe("Kamino live config", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("loads valid config values including bigint action amounts", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "prkt-kamino-config-"));
    const configPath = path.join(tempDir, "kamino_live.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        actions: {
          borrowAmountRaw: "1000000",
          depositAmountRaw: 2000000
        },
        borrowMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        cluster: "devnet",
        depositMint: "So11111111111111111111111111111111111111112",
        marketAddress: "11111111111111111111111111111111",
        programId: "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
      }),
      "utf8"
    );
    process.env.KAMINO_LIVE_CONFIG_PATH = configPath;

    const result = loadKaminoLiveConfig();

    expect(result.actions.depositAmountRaw).toBe(2000000n);
    expect(result.actions.borrowAmountRaw).toBe(1000000n);
    expect(result.cluster).toBe("devnet");

    rmSync(tempDir, { force: true, recursive: true });
  });

  it("rejects unsupported clusters", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "prkt-kamino-config-"));
    const configPath = path.join(tempDir, "kamino_live.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        actions: {
          borrowAmountRaw: "1000000",
          depositAmountRaw: "2000000"
        },
        borrowMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        cluster: "testnet",
        depositMint: "So11111111111111111111111111111111111111112",
        marketAddress: "11111111111111111111111111111111",
        programId: "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
      }),
      "utf8"
    );
    process.env.KAMINO_LIVE_CONFIG_PATH = configPath;

    expect(() => loadKaminoLiveConfig()).toThrow(
      "cluster must be one of 'devnet', 'localnet', or 'mainnet-beta'."
    );

    rmSync(tempDir, { force: true, recursive: true });
  });
});
