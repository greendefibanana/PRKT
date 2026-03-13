import { WalletManager } from "../../src/wallet/WalletManager";
import { KoraRpcClient } from "../../src/kora/KoraRpcClient";
import { KoraSigner } from "../../src/kora/KoraSigner";

describe("KoraSigner", () => {
  it("returns a deterministic mock signature in mock mode", async () => {
    const signer = new KoraSigner(new KoraRpcClient("http://127.0.0.1:8080"), {
      mockMode: true
    });
    const walletManager = WalletManager.generate();

    const first = await signer.submitGaslessMemo(walletManager, "memo-check");
    const second = await signer.submitGaslessMemo(walletManager, "memo-check");

    expect(first.mock).toBe(true);
    expect(first.signature).toHaveLength(64);
    expect(first.signature).toBe(second.signature);
  });

  it("falls back to a deterministic mock signature when live Kora submission fails", async () => {
    const signer = new KoraSigner(
      new KoraRpcClient("http://127.0.0.1:8080", jest.fn(async () => {
        throw new Error("kora unavailable");
      }) as typeof fetch),
      {
        fallbackToMockOnError: true,
        mockMode: false
      }
    );
    const walletManager = WalletManager.generate();

    const result = await signer.submitGaslessMemo(walletManager, "memo-check");

    expect(result.mock).toBe(true);
    expect(result.fallbackReason).toContain("kora unavailable");
    expect(result.signature).toHaveLength(64);
  });
});
