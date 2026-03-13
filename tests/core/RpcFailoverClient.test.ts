import { RpcFailoverClient } from "../../src/core/rpc/RpcFailoverClient";

// Minimal mock to verify failover logic without hitting real RPC
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

// We need to mock the Connection constructor to inject our mocks
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

const { __setMockConnections, __resetCallCount } = jest.requireMock("@solana/web3.js") as {
    __setMockConnections: (mocks: unknown[]) => void;
    __resetCallCount: () => void;
};

beforeEach(() => {
    __resetCallCount();
});

describe("RpcFailoverClient", () => {
    it("succeeds on primary without touching fallback", async () => {
        const primaryMock = createMockConnection();
        const fallbackMock = createMockConnection();
        __setMockConnections([primaryMock, fallbackMock]);

        const client = new RpcFailoverClient({
            primaryUrl: "https://primary.example.com",
            fallbackUrl: "https://fallback.example.com"
        });

        const result = await client.getLatestBlockhash();

        expect(result.blockhash).toBe("11111111111111111111111111111111");
    });

    it("falls back to secondary when primary fails all retries", async () => {
        const primaryMock = createMockConnection({
            getBalance: jest.fn().mockRejectedValue(new Error("primary down"))
        });
        const fallbackMock = createMockConnection({
            getBalance: jest.fn(async () => 999)
        });
        __setMockConnections([primaryMock, fallbackMock]);

        const client = new RpcFailoverClient({
            primaryUrl: "https://primary.example.com",
            fallbackUrl: "https://fallback.example.com",
            maxRetries: 1,
            baseDelayMs: 1,
            maxDelayMs: 1
        });

        const mockPublicKey = { toBase58: () => "11111111111111111111111111111112" } as never;
        const balance = await client.getBalance(mockPublicKey);

        expect(balance).toBe(999);
    });

    it("retries on primary before giving up", async () => {
        const getBalanceMock = jest
            .fn()
            .mockRejectedValueOnce(new Error("temporary error"))
            .mockResolvedValue(42);

        const primaryMock = createMockConnection({ getBalance: getBalanceMock });
        __setMockConnections([primaryMock]);

        const client = new RpcFailoverClient({
            primaryUrl: "https://primary.example.com",
            maxRetries: 3,
            baseDelayMs: 1,
            maxDelayMs: 1
        });

        const mockPublicKey = { toBase58: () => "key" } as never;
        const result = await client.getBalance(mockPublicKey);

        expect(result).toBe(42);
        expect(getBalanceMock).toHaveBeenCalledTimes(2);
    });

    it("throws the last error when all endpoints and retries are exhausted", async () => {
        const primaryMock = createMockConnection({
            getBalance: jest.fn().mockRejectedValue(new Error("primary down"))
        });
        const fallbackMock = createMockConnection({
            getBalance: jest.fn().mockRejectedValue(new Error("fallback also down"))
        });
        __setMockConnections([primaryMock, fallbackMock]);

        const client = new RpcFailoverClient({
            primaryUrl: "https://primary.example.com",
            fallbackUrl: "https://fallback.example.com",
            maxRetries: 1,
            baseDelayMs: 1,
            maxDelayMs: 1
        });

        const mockPublicKey = { toBase58: () => "key" } as never;

        await expect(client.getBalance(mockPublicKey)).rejects.toThrow("fallback also down");
    });

    it("works with no fallback configured", async () => {
        const primaryMock = createMockConnection();
        __setMockConnections([primaryMock]);

        const client = new RpcFailoverClient({
            primaryUrl: "https://primary.example.com"
        });

        const result = await client.getLatestBlockhash();
        expect(result.blockhash).toBe("11111111111111111111111111111111");
    });

    it("exposes primaryUrl and fallbackUrl", () => {
        __setMockConnections([createMockConnection(), createMockConnection()]);

        const client = new RpcFailoverClient({
            primaryUrl: "https://primary.example.com",
            fallbackUrl: "https://fallback.example.com"
        });

        expect(client.primaryUrl).toBe("https://primary.example.com");
        expect(client.fallbackUrl).toBe("https://fallback.example.com");
    });
});
