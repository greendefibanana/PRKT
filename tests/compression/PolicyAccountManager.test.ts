import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";

const writeAccountMock = jest.fn();
const findAccountsByOwnerMock = jest.fn();
const compressedDataAccountConstructorMock = jest.fn();

jest.mock("../../src/zkCompression/CompressedDataAccount", () => ({
  CompressedDataAccount: function (...args: unknown[]) {
    compressedDataAccountConstructorMock(...args);
    return {
      findAccountsByOwner: (...innerArgs: unknown[]) => findAccountsByOwnerMock(...innerArgs),
      writeAccount: (...innerArgs: unknown[]) => writeAccountMock(...innerArgs)
    };
  }
}));

import { PolicyAccountManager } from "../../src/compression/PolicyAccountManager";

describe("PolicyAccountManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("writes compressed policy records without memos", async () => {
    writeAccountMock.mockResolvedValue({
      address: "compressed-policy-address",
      payload: { a: "agent-1" },
      signature: "policy-sig",
      slot: 21
    });

    const manager = new PolicyAccountManager("https://api.devnet.solana.com");
    const signature = await manager.createCompressedPolicyAccount(
      "agent-create",
      {
        dailySpendLimit: new BN(1000),
        killSwitchActive: false,
        lastResetTimestamp: 1,
        programAllowlist: [new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")],
        sessionTTL: 15,
        spentToday: new BN(2)
      },
      Keypair.generate()
    );

    expect(writeAccountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        discriminator: "PRKTPOL1",
        namespace: "prkt-policy",
        payer: expect.anything()
      })
    );
    expect(signature).toBe("policy-sig");
  });

  it("fetches the latest compressed policy version by timestamp", async () => {
    findAccountsByOwnerMock.mockResolvedValue([
      {
        address: "older",
        exists: true,
        payload: {
          a: "agent-1",
          d: "100",
          k: 0,
          l: [],
          r: 1,
          s: 15,
          t: "5",
          u: 100
        }
      },
      {
        address: "newer",
        exists: true,
        payload: {
          a: "agent-1",
          d: "999",
          k: 1,
          l: ["MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"],
          r: 2,
          s: 30,
          t: "8",
          u: 200
        }
      }
    ]);

    const manager = new PolicyAccountManager("https://api.devnet.solana.com");
    const policy = await manager.fetchCompressedPolicyAccount("agent-1");

    expect(findAccountsByOwnerMock).toHaveBeenCalledWith({
      discriminator: "PRKTPOL1"
    });
    expect(policy.dailySpendLimit.toString()).toBe("999");
    expect(policy.killSwitchActive).toBe(true);
    expect(policy.sessionTTL).toBe(30);
    expect(policy.spentToday.toString()).toBe("8");
  });
});
