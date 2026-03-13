import { unlinkSync, writeFileSync } from "fs";
import path from "path";

import { loadRaydiumLpDevnetConfig } from "../../src/defi/lp/raydiumDevnetConfig";

describe("loadRaydiumLpDevnetConfig", () => {
  const originalPath = process.env.RAYDIUM_LP_CONFIG_PATH;
  const tempFileName = "raydium_lp.devnet.test.json";
  const tempFilePath = path.join(process.cwd(), tempFileName);

  afterEach(() => {
    if (originalPath === undefined) {
      delete process.env.RAYDIUM_LP_CONFIG_PATH;
    } else {
      process.env.RAYDIUM_LP_CONFIG_PATH = originalPath;
    }

    try {
      unlinkSync(tempFilePath);
    } catch {
      // Ignore cleanup errors when the file was not created.
    }
  });

  it("loads and validates a devnet Raydium LP config file", () => {
    process.env.RAYDIUM_LP_CONFIG_PATH = tempFileName;

    writeFileSync(
      tempFilePath,
      JSON.stringify(
        {
          amounts: {
            baseAmountIn: 1_000_000,
            otherAmountMin: 900_000,
            quoteAmountIn: 1_000_000
          },
          poolConfig: {
            authority: "11111111111111111111111111111111",
            baseVault: "11111111111111111111111111111111",
            lpMint: "11111111111111111111111111111111",
            marketEventQueue: "11111111111111111111111111111111",
            marketId: "11111111111111111111111111111111",
            openOrders: "11111111111111111111111111111111",
            poolId: "11111111111111111111111111111111",
            poolType: "Standard",
            programId: "11111111111111111111111111111111",
            quoteVault: "11111111111111111111111111111111",
            targetOrders: "11111111111111111111111111111111"
          },
          userTokenAccounts: {
            baseTokenAccount: "11111111111111111111111111111111",
            lpTokenAccount: "11111111111111111111111111111111",
            quoteTokenAccount: "11111111111111111111111111111111"
          }
        },
        null,
        2
      )
    );

    const config = loadRaydiumLpDevnetConfig();

    expect(config.amounts.baseAmountIn).toBe(1_000_000);
    expect(config.poolConfig.poolType).toBe("Standard");
    expect(config.userTokenAccounts.lpTokenAccount).toBe("11111111111111111111111111111111");
  });
});
