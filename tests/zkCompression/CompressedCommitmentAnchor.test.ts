const createRpcMock = jest.fn();
const createAccountMock = jest.fn();
const deriveAddressMock = jest.fn();
const deriveAddressSeedMock = jest.fn();
const createBN254Mock = jest.fn();

jest.mock("@lightprotocol/stateless.js", () => ({
  createAccount: (...args: unknown[]) => createAccountMock(...args),
  createBN254: (...args: unknown[]) => createBN254Mock(...args),
  createRpc: (...args: unknown[]) => createRpcMock(...args),
  deriveAddress: (...args: unknown[]) => deriveAddressMock(...args),
  deriveAddressSeed: (...args: unknown[]) => deriveAddressSeedMock(...args)
}));

const getZkCompressionApiUrlMock = jest.fn();
const getZkProverUrlMock = jest.fn();

jest.mock("../../src/config/env", () => ({
  detectClusterFromRpcUrl: () => "devnet",
  getZkCompressionApiUrl: () => getZkCompressionApiUrlMock(),
  getZkProverUrl: () => getZkProverUrlMock()
}));

import { Keypair } from "@solana/web3.js";

import { CompressedCommitmentAnchor } from "../../src/zkCompression/CompressedCommitmentAnchor";

describe("CompressedCommitmentAnchor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getZkCompressionApiUrlMock.mockReturnValue("https://compression.devnet.example.com");
    getZkProverUrlMock.mockReturnValue("https://prover.devnet.example.com");
    createRpcMock.mockReturnValue({
      getCompressedAccount: jest.fn(async () => null),
      getParsedTransaction: jest.fn(async () => ({ slot: 77 }))
    });
    deriveAddressSeedMock.mockReturnValue(Buffer.alloc(32, 7));
    deriveAddressMock.mockReturnValue({
      toBase58: () => "compressed-address",
      toBytes: () => Uint8Array.from({ length: 32 }, () => 9)
    });
    createBN254Mock.mockImplementation((value: unknown) => value);
    createAccountMock.mockResolvedValue("compressed-tx-sig");
  });

  it("anchors a new compressed commitment", async () => {
    const payer = Keypair.generate();
    const anchor = new CompressedCommitmentAnchor("https://api.devnet.solana.com");

    const result = await anchor.anchorCommitment({
      namespace: "prkt-proof",
      parts: ["tx-1", "intent-1", "policy-1"],
      payer
    });

    expect(createRpcMock).toHaveBeenCalledWith(
      "https://api.devnet.solana.com",
      "https://compression.devnet.example.com",
      "https://prover.devnet.example.com"
    );
    expect(createAccountMock).toHaveBeenCalled();
    expect(result.address).toBe("compressed-address");
    expect(result.signature).toBe("compressed-tx-sig");
    expect(result.slot).toBe(77);
  });

  it("verifies an existing compressed commitment", async () => {
    const rpc = {
      getCompressedAccount: jest.fn(async () => ({ hash: "present" })),
      getParsedTransaction: jest.fn(async () => ({ slot: 88 }))
    };
    createRpcMock.mockReturnValue(rpc);

    const anchor = new CompressedCommitmentAnchor("https://api.devnet.solana.com");
    const result = await anchor.verifyCommitment({
      namespace: "prkt-session-close",
      parts: ["session-1", "commitment-1"]
    });

    expect(rpc.getCompressedAccount).toHaveBeenCalled();
    expect(result).toEqual({
      address: "compressed-address",
      exists: true
    });
  });
});
