import { Keypair } from "@solana/web3.js";

const findAccountsByOwnerMock = jest.fn();
const writeAccountMock = jest.fn();
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

import { AuditLogManager } from "../../src/compression/AuditLogManager";

describe("AuditLogManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("writes audit entries into compressed storage", async () => {
    writeAccountMock.mockResolvedValue({
      address: "audit-address",
      payload: {},
      signature: "audit-sig",
      slot: 12
    });

    const manager = new AuditLogManager("https://api.devnet.solana.com");
    const signature = await manager.appendAuditEntry(
      {
        agentId: "agent-write",
        approved: true,
        intentType: "swap",
        simulationResult: "ok",
        timestamp: 100,
        txSignature: "tx-1"
      },
      Keypair.generate()
    );

    expect(writeAccountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        discriminator: "PRKTAUD1",
        namespace: "prkt-audit",
        payer: expect.anything(),
        parts: expect.arrayContaining(["agent-write", "100"])
      })
    );
    expect(signature).toBe("audit-sig");
  });

  it("fetches compressed audit entries in ascending timestamp order", async () => {
    findAccountsByOwnerMock.mockResolvedValue([
      {
        address: "audit-2",
        exists: true,
        payload: {
          a: "agent-1",
          i: "borrow",
          ok: 0,
          r: "DAILY_LIMIT_EXCEEDED",
          s: "blocked",
          t: 200,
          tx: "tx-2"
        }
      },
      {
        address: "audit-1",
        exists: true,
        payload: {
          a: "agent-1",
          i: "swap",
          ok: 1,
          s: "ok",
          t: 100,
          tx: "tx-1"
        }
      },
      {
        address: "other-agent",
        exists: true,
        payload: {
          a: "agent-2",
          i: "stake",
          ok: 1,
          s: "ok",
          t: 150
        }
      }
    ]);

    const manager = new AuditLogManager("https://api.devnet.solana.com");
    const entries = await manager.fetchAuditLog("agent-1");

    expect(findAccountsByOwnerMock).toHaveBeenCalledWith({
      discriminator: "PRKTAUD1"
    });
    expect(entries).toEqual([
      {
        agentId: "agent-1",
        approved: true,
        intentType: "swap",
        simulationResult: "ok",
        timestamp: 100,
        txSignature: "tx-1"
      },
      {
        agentId: "agent-1",
        approved: false,
        intentType: "borrow",
        rejectionReason: "DAILY_LIMIT_EXCEEDED",
        simulationResult: "blocked",
        timestamp: 200,
        txSignature: "tx-2"
      }
    ]);
  });
});
