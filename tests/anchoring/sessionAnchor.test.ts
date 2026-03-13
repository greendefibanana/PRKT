import { Keypair } from "@solana/web3.js";

const readAccountMock = jest.fn();
const writeAccountMock = jest.fn();
const compressedDataAccountConstructorMock = jest.fn();

jest.mock("../../src/zkCompression/CompressedDataAccount", () => ({
  CompressedDataAccount: function (...args: unknown[]) {
    compressedDataAccountConstructorMock(...args);
    return {
      readAccount: (...innerArgs: unknown[]) => readAccountMock(...innerArgs),
      writeAccount: (...innerArgs: unknown[]) => writeAccountMock(...innerArgs)
    };
  }
}));

import { SessionAnchor } from "../../src/anchoring/SessionAnchor";

describe("SessionAnchor", () => {
  const payer = Keypair.generate();
  const walletManager = { payer };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("starts a session with compressed storage", async () => {
    writeAccountMock.mockResolvedValue({
      address: "session-start-address",
      explorerUrl: "https://explorer/tx/start-sig",
      payload: {},
      signature: "start-sig",
      slot: 40
    });

    const anchor = new SessionAnchor("https://api.devnet.solana.com", walletManager as never);
    const result = await anchor.startSession("agent-1");

    expect(writeAccountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        discriminator: "PRKTSS01",
        namespace: "prkt-session-start",
        payer
      })
    );
    expect(result.startSignature).toBe("start-sig");
    expect(result.compressedAnchorAddress).toBe("session-start-address");
    expect(result.slot).toBe(40);
  });

  it("verifies a session by reading the compressed close record", async () => {
    readAccountMock.mockResolvedValue({
      address: "session-close-address",
      exists: true,
      explorerUrl: "https://explorer/tx/close-sig",
      payload: {
        entryCount: 3,
        event: "SESSION_CLOSE",
        logHash: "hash-1",
        prkt: 1,
        sessionId: "session-1",
        ts: 123
      },
      signature: "close-sig",
      slot: 77
    });

    const anchor = new SessionAnchor("https://api.devnet.solana.com", walletManager as never);
    const result = await anchor.verifySession("session-1", "hash-1");

    expect(readAccountMock).toHaveBeenCalledWith({
      discriminator: "PRKTSC01",
      namespace: "prkt-session-close",
      parts: ["session-1"]
    });
    expect(result).toEqual({
      closeSignature: "close-sig",
      commitment: "hash-1",
      entries: [],
      entryCount: 3,
      explorerUrl: "https://explorer/tx/close-sig",
      slot: 77,
      valid: true
    });
  });
});
