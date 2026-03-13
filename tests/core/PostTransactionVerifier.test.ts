import { Keypair } from "@solana/web3.js";

import { PostTransactionVerifier } from "../../src/core/transactions/PostTransactionVerifier";

describe("PostTransactionVerifier", () => {
  it("verifies SPL token balance increases", async () => {
    const tokenAccount = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const rpcClient = createRpcClient({
      accounts: [true, true],
      balances: ["10", "25"]
    });
    const tokenService = {
      getMintDecimals: jest.fn(async () => 6)
    };
    const verifier = new PostTransactionVerifier(rpcClient as never, tokenService as never);

    const snapshot = await verifier.snapshotSplTokenAccount({
      label: "USDC ATA",
      mint,
      tokenAccount
    });
    const [report] = await verifier.assertBalanceChanges([
      {
        minIncreaseRaw: 10n,
        snapshot
      }
    ]);

    expect(report.beforeRaw).toBe(10n);
    expect(report.afterRaw).toBe(25n);
    expect(report.deltaRaw).toBe(15n);
    expect(report.deltaUi).toBe("+0.000015");
  });

  it("fails when a required increase does not occur", async () => {
    const tokenAccount = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const rpcClient = createRpcClient({
      accounts: [true, true],
      balances: ["20", "20"]
    });
    const tokenService = {
      getMintDecimals: jest.fn(async () => 6)
    };
    const verifier = new PostTransactionVerifier(rpcClient as never, tokenService as never);

    const snapshot = await verifier.snapshotSplTokenAccount({
      mint,
      tokenAccount
    });

    await expect(
      verifier.assertBalanceChanges([
        {
          minIncreaseRaw: 1n,
          snapshot
        }
      ])
    ).rejects.toThrow("expected increase");
  });

  it("treats missing token accounts as zero balance", async () => {
    const owner = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const ata = Keypair.generate().publicKey;
    const rpcClient = createRpcClient({
      accounts: [false, true],
      balances: ["5"]
    });
    const tokenService = {
      findAssociatedTokenAddress: jest.fn(() => ata),
      getMintDecimals: jest.fn(async () => 6)
    };
    const verifier = new PostTransactionVerifier(rpcClient as never, tokenService as never);

    const snapshot = await verifier.snapshotSplBalanceForOwner({
      mint,
      owner
    });
    const [report] = await verifier.assertBalanceChanges([
      {
        minIncreaseRaw: 5n,
        snapshot
      }
    ]);

    expect(report.beforeRaw).toBe(0n);
    expect(report.afterRaw).toBe(5n);
  });
});

function createRpcClient(input: {
  accounts: boolean[];
  balances: string[];
}): {
  getAccountInfo: jest.Mock;
  getBalance: jest.Mock;
  getTokenAccountBalance: jest.Mock;
} {
  let accountIndex = 0;
  let balanceIndex = 0;

  return {
    getAccountInfo: jest.fn(async () => {
      const exists = input.accounts[accountIndex] ?? input.accounts.at(-1) ?? false;
      accountIndex += 1;
      return exists ? { data: Buffer.alloc(0) } : null;
    }),
    getBalance: jest.fn(),
    getTokenAccountBalance: jest.fn(async () => {
      const amount = input.balances[balanceIndex] ?? input.balances.at(-1) ?? "0";
      balanceIndex += 1;
      return {
        value: {
          amount,
          decimals: 6,
          uiAmount: Number(amount) / 1_000_000
        }
      };
    })
  };
}
