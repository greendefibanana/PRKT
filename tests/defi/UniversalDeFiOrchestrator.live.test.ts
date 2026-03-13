import type { VersionedTransaction } from "@solana/web3.js";

import { KoraRpcClient } from "../../src/kora/KoraRpcClient";
import { KoraSigner } from "../../src/kora/KoraSigner";
import { WalletManager } from "../../src/wallet/WalletManager";
import { UniversalDeFiOrchestrator } from "../../src/defi/universal";
import type { PreparedLiveExecution } from "../../src/defi/universal";

const prepareLiveJupiterMock = jest.fn();
const prepareLiveRaydiumLpMock = jest.fn();
const prepareLiveKaminoMock = jest.fn();
const prepareLiveMarinadeMock = jest.fn();

jest.mock("../../src/defi/universal/liveExecutors", () => ({
  prepareLiveJupiter: (...args: unknown[]) => prepareLiveJupiterMock(...args),
  prepareLiveKamino: (...args: unknown[]) => prepareLiveKaminoMock(...args),
  prepareLiveMarinade: (...args: unknown[]) => prepareLiveMarinadeMock(...args),
  prepareLiveRaydiumLp: (...args: unknown[]) => prepareLiveRaydiumLpMock(...args)
}));

describe("UniversalDeFiOrchestrator guarded live execution", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      ENABLE_LIVE_KAMINO: "true",
      ENABLE_LIVE_MARINADE: "true",
      ENABLE_LIVE_SWAP_PATH: "true"
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("routes prepared live transactions through the guarded executor", async () => {
    const verifyExecution = jest.fn(async () => undefined);
    prepareLiveJupiterMock.mockResolvedValue(createPreparedLiveExecution({ verifyExecution }));

    const executePreparedTransaction = jest.fn().mockResolvedValue({
      inspection: {
        allowed: true,
        details: {
          mintsSeen: [],
          programsSeen: [],
          totalSolSpendLamports: 0n,
          totalSplSpendRaw: 0n
        },
        reasons: []
      },
      signature: "live-signature-123",
      simulationLogs: []
    });

    const orchestrator = new UniversalDeFiOrchestrator({
      koraSigner: new KoraSigner(new KoraRpcClient("http://127.0.0.1:8080"), {
        mockMode: true
      }),
      liveFirst: true,
      walletManager: WalletManager.generate()
    });

    const result = await orchestrator.execute(
      {
        capability: "trade",
        snapshot: {
          buyThresholdUsd: 100,
          solPriceUsd: 95
        }
      },
      {
        liveExecutor: {
          executePreparedTransaction
        }
      }
    );

    expect(prepareLiveJupiterMock).toHaveBeenCalledTimes(1);
    expect(executePreparedTransaction).toHaveBeenCalledTimes(1);
    expect(verifyExecution).toHaveBeenCalledWith("live-signature-123");
    expect(result.result?.mock).toBe(false);
    expect(result.result?.signature).toBe("live-signature-123");
  });

  it("falls back to memo execution when the guarded executor blocks the live transaction", async () => {
    prepareLiveJupiterMock.mockResolvedValue(createPreparedLiveExecution());

    const executePreparedTransaction = jest.fn().mockResolvedValue({
      inspection: {
        allowed: false,
        details: {
          mintsSeen: [],
          programsSeen: [],
          totalSolSpendLamports: 0n,
          totalSplSpendRaw: 0n
        },
        reasons: ["program not allowed"]
      },
      signature: null,
      simulationLogs: null
    });

    const orchestrator = new UniversalDeFiOrchestrator({
      koraSigner: new KoraSigner(new KoraRpcClient("http://127.0.0.1:8080"), {
        mockMode: true
      }),
      liveFirst: true,
      walletManager: WalletManager.generate()
    });

    const result = await orchestrator.execute(
      {
        capability: "trade",
        snapshot: {
          buyThresholdUsd: 100,
          solPriceUsd: 95
        }
      },
      {
        liveExecutor: {
          executePreparedTransaction
        }
      }
    );

    expect(prepareLiveJupiterMock).toHaveBeenCalledTimes(1);
    expect(executePreparedTransaction).toHaveBeenCalledTimes(1);
    expect(result.result?.mock).toBe(true);
    expect(result.result?.protocol).toBe("jupiter");
  });

  it("fails the live execution when post-transaction verification fails", async () => {
    prepareLiveJupiterMock.mockResolvedValue(
      createPreparedLiveExecution({
        verifyExecution: jest.fn(async () => {
          throw new Error("post-state verification failed");
        })
      })
    );

    const executePreparedTransaction = jest.fn().mockResolvedValue({
      inspection: {
        allowed: true,
        details: {
          mintsSeen: [],
          programsSeen: [],
          totalSolSpendLamports: 0n,
          totalSplSpendRaw: 0n
        },
        reasons: []
      },
      signature: "live-signature-123",
      simulationLogs: []
    });

    const orchestrator = new UniversalDeFiOrchestrator({
      koraSigner: new KoraSigner(new KoraRpcClient("http://127.0.0.1:8080"), {
        mockMode: true
      }),
      liveFirst: true,
      walletManager: WalletManager.generate()
    });

    await expect(
      orchestrator.execute(
        {
          capability: "trade",
          snapshot: {
            buyThresholdUsd: 100,
            solPriceUsd: 95
          }
        },
        {
          liveExecutor: {
            executePreparedTransaction
          }
        }
      )
    ).rejects.toThrow("post-state verification failed");
  });

  it("routes Kamino borrowing through the guarded live executor when prepared", async () => {
    const verifyExecution = jest.fn(async () => undefined);
    prepareLiveJupiterMock.mockResolvedValue(null);
    prepareLiveRaydiumLpMock.mockResolvedValue(null);
    prepareLiveKaminoMock.mockResolvedValue(
      createPreparedLiveExecution({
        protocol: "kamino",
        verifyExecution
      })
    );

    const executePreparedTransaction = jest.fn().mockResolvedValue({
      inspection: {
        allowed: true,
        details: {
          mintsSeen: [],
          programsSeen: [],
          totalSolSpendLamports: 0n,
          totalSplSpendRaw: 0n
        },
        reasons: []
      },
      signature: "kamino-live-signature-456",
      simulationLogs: []
    });

    const orchestrator = new UniversalDeFiOrchestrator({
      koraSigner: new KoraSigner(new KoraRpcClient("http://127.0.0.1:8080"), {
        mockMode: true
      }),
      liveFirst: true,
      walletManager: WalletManager.generate()
    });

    const result = await orchestrator.execute(
      {
        capability: "borrowing",
        protocol: "kamino",
        snapshot: {
          borrowDemandUsdcAtomic: 3_000_000,
          collateralSolLamports: 1_500_000_000,
          healthFactor: 2.5
        }
      },
      {
        liveExecutor: {
          executePreparedTransaction
        }
      }
    );

    expect(prepareLiveKaminoMock).toHaveBeenCalledTimes(1);
    expect(executePreparedTransaction).toHaveBeenCalledTimes(1);
    expect(verifyExecution).toHaveBeenCalledWith("kamino-live-signature-456");
    expect(result.result?.mock).toBe(false);
    expect(result.result?.protocol).toBe("kamino");
  });

  it("routes Marinade staking through the guarded live executor when prepared", async () => {
    const verifyExecution = jest.fn(async () => undefined);
    prepareLiveJupiterMock.mockResolvedValue(null);
    prepareLiveRaydiumLpMock.mockResolvedValue(null);
    prepareLiveKaminoMock.mockResolvedValue(null);
    prepareLiveMarinadeMock.mockResolvedValue(
      createPreparedLiveExecution({
        protocol: "marinade",
        verifyExecution
      })
    );

    const executePreparedTransaction = jest.fn().mockResolvedValue({
      inspection: {
        allowed: true,
        details: {
          mintsSeen: [],
          programsSeen: [],
          totalSolSpendLamports: 0n,
          totalSplSpendRaw: 0n
        },
        reasons: []
      },
      signature: "marinade-live-signature-789",
      simulationLogs: []
    });

    const orchestrator = new UniversalDeFiOrchestrator({
      koraSigner: new KoraSigner(new KoraRpcClient("http://127.0.0.1:8080"), {
        mockMode: true
      }),
      liveFirst: true,
      walletManager: WalletManager.generate()
    });

    const result = await orchestrator.execute(
      {
        capability: "staking",
        protocol: "marinade",
        snapshot: {
          idleSolLamports: 2_000_000_000
        }
      },
      {
        liveExecutor: {
          executePreparedTransaction
        }
      }
    );

    expect(prepareLiveMarinadeMock).toHaveBeenCalledTimes(1);
    expect(executePreparedTransaction).toHaveBeenCalledTimes(1);
    expect(verifyExecution).toHaveBeenCalledWith("marinade-live-signature-789");
    expect(result.result?.mock).toBe(false);
    expect(result.result?.protocol).toBe("marinade");
  });
});

function createPreparedLiveExecution(input?: {
  protocol?: "jupiter" | "kamino" | "marinade";
  verifyExecution?: (signature: string) => Promise<void>;
}): PreparedLiveExecution {
  return {
    protocol: input?.protocol ?? "jupiter",
    toExecutionResult(signature: string) {
      return {
        action:
          input?.protocol === "kamino"
            ? "borrow"
            : input?.protocol === "marinade"
              ? "stake"
              : "trade",
        memo:
          input?.protocol === "kamino"
            ? "LIVE:KAMINO:test"
            : input?.protocol === "marinade"
              ? "LIVE:MARINADE:test"
              : "LIVE:JUPITER:test",
        mock: false,
        protocol: input?.protocol ?? "jupiter",
        signature
      };
    },
    transaction: {} as VersionedTransaction,
    verifyExecution: input?.verifyExecution
  };
}
