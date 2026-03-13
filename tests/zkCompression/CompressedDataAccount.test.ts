const buildAndSignTxMock = jest.fn();
const createBN254Mock = jest.fn();
const createCompressedAccountLegacyMock = jest.fn();
const createRpcMock = jest.fn();
const defaultStaticAccountsStructMock = jest.fn();
const deriveAddressMock = jest.fn();
const deriveAddressSeedMock = jest.fn();
const encodeInstructionDataInvokeMock = jest.fn();
const getDefaultAddressTreeInfoMock = jest.fn();
const hashvToBn254FieldSizeBeMock = jest.fn();
const invokeAccountsLayoutMock = jest.fn();
const packCompressedAccountsMock = jest.fn();
const packNewAddressParamsMock = jest.fn();
const selectStateTreeInfoMock = jest.fn();
const sendAndConfirmTxMock = jest.fn();
const toAccountMetasMock = jest.fn();

jest.mock("@lightprotocol/stateless.js", () => ({
  LightSystemProgram: {
    programId: { toBase58: () => "light-system-program" }
  },
  buildAndSignTx: (...args: unknown[]) => buildAndSignTxMock(...args),
  createBN254: (...args: unknown[]) => createBN254Mock(...args),
  createCompressedAccountLegacy: (...args: unknown[]) => createCompressedAccountLegacyMock(...args),
  createRpc: (...args: unknown[]) => createRpcMock(...args),
  defaultStaticAccountsStruct: (...args: unknown[]) => defaultStaticAccountsStructMock(...args),
  deriveAddress: (...args: unknown[]) => deriveAddressMock(...args),
  deriveAddressSeed: (...args: unknown[]) => deriveAddressSeedMock(...args),
  encodeInstructionDataInvoke: (...args: unknown[]) => encodeInstructionDataInvokeMock(...args),
  getDefaultAddressTreeInfo: (...args: unknown[]) => getDefaultAddressTreeInfoMock(...args),
  hashvToBn254FieldSizeBe: (...args: unknown[]) => hashvToBn254FieldSizeBeMock(...args),
  invokeAccountsLayout: (...args: unknown[]) => invokeAccountsLayoutMock(...args),
  packCompressedAccounts: (...args: unknown[]) => packCompressedAccountsMock(...args),
  packNewAddressParams: (...args: unknown[]) => packNewAddressParamsMock(...args),
  selectStateTreeInfo: (...args: unknown[]) => selectStateTreeInfoMock(...args),
  sendAndConfirmTx: (...args: unknown[]) => sendAndConfirmTxMock(...args),
  toAccountMetas: (...args: unknown[]) => toAccountMetasMock(...args)
}));

const getZkCompressionApiUrlMock = jest.fn();
const getZkProverUrlMock = jest.fn();

jest.mock("../../src/config/env", () => ({
  detectClusterFromRpcUrl: () => "devnet",
  isDefensibleDevnetDemoMode: () => false,
  getZkCompressionApiUrl: () => getZkCompressionApiUrlMock(),
  getZkProverUrl: () => getZkProverUrlMock()
}));

import { Keypair, PublicKey } from "@solana/web3.js";

import { CompressedDataAccount } from "../../src/zkCompression/CompressedDataAccount";

describe("CompressedDataAccount", () => {
  const addressTree = new PublicKey("7YJcU4qJvQvYfDPJv1nVbWcv16Mo3ayD9n1VWeNseyX2");
  const queueTree = new PublicKey("3n1mQv8w5L9iK1qKxDafnXwZB9SVskLFaPrqHcKXqsw6");
  const stateTree = new PublicKey("CisHSTu6pRPxvaNFuPu6jMnHh4jPCcgUp3NEPoPFcAck");
  const stateQueue = new PublicKey("H8xg7sWXBJgp7wa9uRc42PFpKnzGWxZmfZbduCMsZbxD");

  beforeEach(() => {
    jest.clearAllMocks();
    getZkCompressionApiUrlMock.mockReturnValue("https://compression.devnet.example.com");
    getZkProverUrlMock.mockReturnValue("https://prover.devnet.example.com");
    createBN254Mock.mockImplementation((value: unknown) => value);
    deriveAddressSeedMock.mockReturnValue(Buffer.alloc(32, 7));
    deriveAddressMock.mockReturnValue({
      toBase58: () => "compressed-data-address",
      toBytes: () => Uint8Array.from({ length: 32 }, () => 9)
    });
    defaultStaticAccountsStructMock.mockReturnValue({});
    getDefaultAddressTreeInfoMock.mockReturnValue({
      queue: queueTree,
      tree: addressTree
    });
    selectStateTreeInfoMock.mockReturnValue({
      queue: stateQueue,
      tree: stateTree
    });
    hashvToBn254FieldSizeBeMock.mockReturnValue(Uint8Array.from({ length: 32 }, (_, index) => index));
    packCompressedAccountsMock.mockReturnValue({
      packedInputCompressedAccounts: [],
      packedOutputCompressedAccounts: [{ compressedAccount: { owner: "memo" }, merkleTreeIndex: 0 }],
      remainingAccounts: []
    });
    packNewAddressParamsMock.mockReturnValue({
      newAddressParamsPacked: [{ seed: Array.from(Buffer.alloc(32, 7)) }],
      remainingAccounts: []
    });
    encodeInstructionDataInvokeMock.mockReturnValue(Buffer.from("invoke"));
    invokeAccountsLayoutMock.mockReturnValue([]);
    toAccountMetasMock.mockReturnValue([]);
    buildAndSignTxMock.mockReturnValue("signed-transaction");
    sendAndConfirmTxMock.mockResolvedValue("compressed-write-signature");
    createCompressedAccountLegacyMock.mockReturnValue({ owner: "memo" });
    createRpcMock.mockReturnValue({
      getCompressedAccount: jest.fn(async () => null),
      getCompressedAccountsByOwner: jest.fn(async () => ({ cursor: null, items: [] })),
      getCompressionSignaturesForAddress: jest.fn(async () => ({
        items: [{ blockTime: 1_700_000_000, signature: "compressed-write-signature", slot: 44 }]
      })),
      getLatestBlockhash: jest.fn(async () => ({ blockhash: "latest-blockhash" })),
      getStateTreeInfos: jest.fn(async () => [{ queue: stateQueue, tree: stateTree }]),
      getValidityProofV0: jest.fn(async () => ({
        compressedProof: null,
        rootIndices: [5],
        treeInfos: [{ queue: queueTree, tree: addressTree }]
      }))
    });
  });

  it("writes payload bytes into a compressed account", async () => {
    const payer = Keypair.generate();
    const store = new CompressedDataAccount("https://api.devnet.solana.com");

    const result = await store.writeAccount({
      discriminator: "PRKTPOL1",
      namespace: "prkt-policy",
      parts: ["agent-1", "100"],
      payer,
      payload: { agentId: "agent-1", updatedAt: 100 }
    });

    expect(createCompressedAccountLegacyMock).toHaveBeenCalled();
    const compressedPayload = createCompressedAccountLegacyMock.mock.calls[0][2];
    expect(compressedPayload.discriminator).toEqual(Array.from(Buffer.from("PRKTPOL1", "utf8")));
    expect(Buffer.from(compressedPayload.data).toString("utf8")).toContain("\"agentId\":\"agent-1\"");
    expect(hashvToBn254FieldSizeBeMock).toHaveBeenCalled();
    expect(result).toEqual({
      address: "compressed-data-address",
      explorerUrl: expect.stringContaining("compressed-write-signature"),
      payload: { agentId: "agent-1", updatedAt: 100 },
      signature: "compressed-write-signature",
      slot: 44
    });
  });

  it("reads and decodes a compressed payload", async () => {
    createRpcMock.mockReturnValue({
      getCompressedAccount: jest.fn(async () => ({
        data: {
          data: Buffer.from(JSON.stringify({ sessionId: "session-1" }), "utf8"),
          discriminator: Array.from(Buffer.from("PRKTSC01", "utf8"))
        }
      })),
      getCompressedAccountsByOwner: jest.fn(async () => ({ cursor: null, items: [] })),
      getCompressionSignaturesForAddress: jest.fn(async () => ({
        items: [{ blockTime: 1_700_000_000, signature: "session-sig", slot: 88 }]
      })),
      getLatestBlockhash: jest.fn(async () => ({ blockhash: "latest-blockhash" })),
      getStateTreeInfos: jest.fn(async () => [{ queue: stateQueue, tree: stateTree }]),
      getValidityProofV0: jest.fn(async () => ({
        compressedProof: null,
        rootIndices: [5],
        treeInfos: [{ queue: queueTree, tree: addressTree }]
      }))
    });

    const store = new CompressedDataAccount("https://api.devnet.solana.com");
    const result = await store.readAccount<{ sessionId: string }>({
      discriminator: "PRKTSC01",
      namespace: "prkt-session-close",
      parts: ["session-1"]
    });

    expect(result).toEqual({
      address: "compressed-data-address",
      exists: true,
      explorerUrl: expect.stringContaining("session-sig"),
      payload: { sessionId: "session-1" },
      signature: "session-sig",
      slot: 88
    });
  });
});
