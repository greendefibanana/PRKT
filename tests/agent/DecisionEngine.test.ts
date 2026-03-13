import type { AccountInfo, SignatureResult } from "@solana/web3.js";

import { DecisionEngine, type DecisionEngineConnection } from "../../src/agent/DecisionEngine";
import { WalletManager } from "../../src/wallet/WalletManager";

function createTokenBalance(uiAmount: number) {
  return {
    context: {
      slot: 1
    },
    value: {
      amount: Math.round(uiAmount * 1_000_000_000).toString(),
      decimals: 9,
      uiAmount,
      uiAmountString: uiAmount.toFixed(4)
    }
  };
}

function createConfirmationResult(): { context: { slot: number }; value: SignatureResult } {
  return {
    context: {
      slot: 1
    },
    value: {
      err: null
    }
  };
}

describe("DecisionEngine", () => {
  it("wraps SOL when wSOL liquidity is below the trading threshold", async () => {
    const walletManager = WalletManager.generate();
    const logger = jest.fn<void, [string]>();
    const connection: DecisionEngineConnection = {
      confirmTransaction: jest.fn(async () => createConfirmationResult()),
      getAccountInfo: jest.fn(async () => null),
      getBalance: jest.fn(async () => 200_000_000),
      getLatestBlockhash: jest.fn(async () => ({
        blockhash: "11111111111111111111111111111111",
        lastValidBlockHeight: 10
      })),
      getTokenAccountBalance: jest.fn(async () => createTokenBalance(0.05)),
      sendTransaction: jest.fn(async () => "wrap-signature")
    };

    const agent = new DecisionEngine(connection, walletManager, logger);
    const result = await agent.think();

    expect(result.action).toBe("wrap");
    expect(result.reason).toContain("My wSOL liquidity is low for trading");
    if (result.action !== "wrap") {
      throw new Error("Expected wrap result.");
    }
    expect(result.signature).toBe("wrap-signature");
    expect(connection.sendTransaction).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining("Reasoning: My wSOL liquidity is low for trading")
    );
  });

  it("holds when the wallet already has enough wSOL liquidity", async () => {
    const walletManager = WalletManager.generate();
    const logger = jest.fn<void, [string]>();
    const connection: DecisionEngineConnection = {
      confirmTransaction: jest.fn(async () => createConfirmationResult()),
      getAccountInfo: jest.fn(
        async () =>
          ({
            data: Buffer.alloc(0),
            executable: false,
            lamports: 1,
            owner: walletManager.publicKey,
            rentEpoch: 0
          }) as AccountInfo<Buffer>
      ),
      getBalance: jest.fn(async () => 500_000_000),
      getLatestBlockhash: jest.fn(async () => ({
        blockhash: "11111111111111111111111111111111",
        lastValidBlockHeight: 10
      })),
      getTokenAccountBalance: jest.fn(async () => createTokenBalance(0.02)),
      sendTransaction: jest.fn(async () => "unused")
    };

    const agent = new DecisionEngine(connection, walletManager, logger);
    const result = await agent.think();

    expect(result.action).toBe("hold");
    expect(result.reason).toContain("No liquidity adjustment is required");
    expect(connection.sendTransaction).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining("Reasoning: My current SOL and wSOL balances are sufficient")
    );
  });
});
