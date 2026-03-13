function createMockConnection(overrides: Record<string, jest.Mock> = {}) {
  return {
    rpcEndpoint: "https://mock-rpc.example.com",
    getBalance: jest.fn(async () => 1_000_000),
    getLatestBlockhash: jest.fn(async () => ({
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 100
    })),
    getTokenAccountBalance: jest.fn(async () => ({
      context: { slot: 1 },
      value: { amount: "0", decimals: 6, uiAmount: 0 }
    })),
    getAccountInfo: jest.fn(async () => null),
    sendTransaction: jest.fn(async () => "mock-signature"),
    confirmTransaction: jest.fn(async () => ({
      context: { slot: 1 },
      value: { err: null }
    })),
    simulateTransaction: jest.fn(async () => ({
      context: { slot: 1 },
      value: { err: null, logs: [], unitsConsumed: 0 }
    })),
    requestAirdrop: jest.fn(async () => "airdrop-sig"),
    ...overrides
  };
}

jest.mock("@solana/web3.js", () => {
  const actual = jest.requireActual("@solana/web3.js");
  let callCount = 0;
  const mockConnections: unknown[] = [];

  return {
    ...actual,
    Connection: jest.fn().mockImplementation(function (this: unknown, url: string) {
      const mock = mockConnections[callCount] ?? createMockConnection();
      callCount += 1;
      Object.assign(this as Record<string, unknown>, mock);
      (this as Record<string, unknown>).rpcEndpoint = url;
      return this;
    }),
    __setMockConnections: (mocks: unknown[]) => {
      callCount = 0;
      mockConnections.length = 0;
      mockConnections.push(...mocks);
    },
    __resetCallCount: () => {
      callCount = 0;
    }
  };
});

jest.mock("../../src/config/env", () => {
  const actual = jest.requireActual("../../src/config/env");
  return {
    ...actual,
    getRpcFallbackUrl: jest.fn(() => null)
  };
});

import { RpcClient } from "../../src/core/rpc/RpcClient";

const { __setMockConnections, __resetCallCount } = jest.requireMock("@solana/web3.js") as {
  __setMockConnections: (mocks: unknown[]) => void;
  __resetCallCount: () => void;
};
const { getRpcFallbackUrl } = jest.requireMock("../../src/config/env") as {
  getRpcFallbackUrl: jest.Mock<string | null, []>;
};

beforeEach(() => {
  __resetCallCount();
  getRpcFallbackUrl.mockReturnValue(null);
});

describe("RpcClient", () => {
  it("uses the primary connection directly when no fallback RPC is configured", async () => {
    const primaryMock = createMockConnection({
      getBalance: jest.fn(async () => 42)
    });
    __setMockConnections([primaryMock]);

    const client = new RpcClient("https://primary.example.com");
    const mockPublicKey = { toBase58: () => "key" } as never;

    await expect(client.getBalance(mockPublicKey)).resolves.toBe(42);
    expect(primaryMock.getBalance).toHaveBeenCalledTimes(1);
  });

  it("fails over to the fallback RPC for read calls when configured", async () => {
    const primaryMock = createMockConnection({
      getBalance: jest.fn().mockRejectedValue(new Error("primary down"))
    });
    const fallbackMock = createMockConnection({
      getBalance: jest.fn(async () => 99)
    });
    __setMockConnections([primaryMock, primaryMock, fallbackMock]);
    getRpcFallbackUrl.mockReturnValue("https://fallback.example.com");

    const client = new RpcClient("https://primary.example.com");
    const mockPublicKey = { toBase58: () => "key" } as never;

    await expect(client.getBalance(mockPublicKey)).resolves.toBe(99);
  });
});
