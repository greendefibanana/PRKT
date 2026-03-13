import { Keypair } from "@solana/web3.js";

import { BalanceService } from "../../src/core/balances/BalanceService";
import { DevnetFundingService } from "../../src/core/funding/DevnetFundingService";
import { RpcClient } from "../../src/core/rpc/RpcClient";
import { TransactionService } from "../../src/core/transactions/TransactionService";
import { WalletManager } from "../../src/wallet/WalletManager";

describe("DevnetFundingService", () => {
  it("returns null when the recipient already has enough SOL", async () => {
    const rpcClient = {} as RpcClient;
    const transactionService = {} as TransactionService;
    const balanceService = {
      getSolBalance: jest.fn(async () => 0.75)
    } as unknown as BalanceService;
    const service = new DevnetFundingService(rpcClient, transactionService, null);

    const result = await service.ensureMinimumSol({
      balanceService,
      minimumSol: 0.5,
      recipient: Keypair.generate().publicKey
    });

    expect(result).toBeNull();
  });

  it("uses treasury transfer when a treasury wallet is configured", async () => {
    const buildTransaction = jest.fn(async () => ({ transaction: { sign: jest.fn() } }));
    const sendAndConfirm = jest.fn(async () => ({ signature: "treasury-sig", slot: 1 }));
    const requestAirdrop = jest.fn();
    const rpcClient = {
      confirmTransaction: jest.fn(),
      getBalance: jest.fn(async () => 2_000_000_000),
      requestAirdrop
    } as unknown as RpcClient;
    const transactionService = {
      buildSolTransferInstructionInSol: jest.fn(() => ({ keys: [] })),
      buildTransaction,
      sendAndConfirm
    } as unknown as TransactionService;
    const treasuryWallet = WalletManager.generate();
    const service = new DevnetFundingService(rpcClient, transactionService, treasuryWallet);

    const result = await service.fundExactSol({
      amountSol: 0.2,
      recipient: Keypair.generate().publicKey
    });

    expect(result).toEqual({
      signature: "treasury-sig",
      source: "treasury-transfer"
    });
    expect(buildTransaction).toHaveBeenCalled();
    expect(sendAndConfirm).toHaveBeenCalled();
    expect(requestAirdrop).not.toHaveBeenCalled();
  });

  it("falls back to airdrop when no treasury wallet is configured", async () => {
    const confirmTransaction = jest.fn();
    const requestAirdrop = jest.fn(async () => "airdrop-sig");
    const rpcClient = {
      confirmTransaction,
      requestAirdrop
    } as unknown as RpcClient;
    const transactionService = {} as TransactionService;
    const service = new DevnetFundingService(rpcClient, transactionService, null);

    const result = await service.fundExactSol({
      amountSol: 0.3,
      recipient: Keypair.generate().publicKey
    });

    expect(result).toEqual({
      signature: "airdrop-sig",
      source: "airdrop"
    });
    expect(requestAirdrop).toHaveBeenCalled();
    expect(confirmTransaction).toHaveBeenCalledWith("airdrop-sig", "confirmed");
  });

  it("falls back to airdrop when the treasury transfer fails", async () => {
    const confirmTransaction = jest.fn();
    const requestAirdrop = jest.fn(async () => "airdrop-fallback-sig");
    const rpcClient = {
      confirmTransaction,
      getBalance: jest.fn(async () => 2_000_000_000),
      requestAirdrop
    } as unknown as RpcClient;
    const transactionService = {
      buildSolTransferInstructionInSol: jest.fn(() => ({ keys: [] })),
      buildTransaction: jest.fn(async () => ({ transaction: { sign: jest.fn() } })),
      sendAndConfirm: jest.fn(async () => {
        throw new Error("insufficient lamports");
      })
    } as unknown as TransactionService;
    const treasuryWallet = WalletManager.generate();
    const service = new DevnetFundingService(rpcClient, transactionService, treasuryWallet);

    const result = await service.fundExactSol({
      amountSol: 0.8,
      recipient: Keypair.generate().publicKey
    });

    expect(result).toEqual({
      signature: "airdrop-fallback-sig",
      source: "airdrop"
    });
    expect(requestAirdrop).toHaveBeenCalled();
    expect(confirmTransaction).toHaveBeenCalledWith("airdrop-fallback-sig", "confirmed");
  });

  it("uses the treasury first and only airdrops the remainder when the treasury is low", async () => {
    const confirmTransaction = jest.fn();
    const requestAirdrop = jest.fn(async () => "airdrop-remainder-sig");
    const buildTransaction = jest.fn(async () => ({ transaction: { sign: jest.fn() } }));
    const sendAndConfirm = jest.fn(async () => ({ signature: "partial-treasury-sig", slot: 1 }));
    const rpcClient = {
      confirmTransaction,
      getBalance: jest.fn(async () => 900_000_000),
      requestAirdrop
    } as unknown as RpcClient;
    const transactionService = {
      buildSolTransferInstructionInSol: jest.fn(() => ({ keys: [] })),
      buildTransaction,
      sendAndConfirm
    } as unknown as TransactionService;
    const treasuryWallet = WalletManager.generate();
    const service = new DevnetFundingService(rpcClient, transactionService, treasuryWallet);
    const recipient = Keypair.generate().publicKey;

    const result = await service.fundExactSol({
      amountSol: 1.2,
      recipient
    });

    expect(result).toEqual({
      signature: "airdrop-remainder-sig",
      source: "hybrid"
    });
    expect(sendAndConfirm).toHaveBeenCalledTimes(1);
    expect(requestAirdrop).toHaveBeenCalledWith(recipient, 350_000_000);
    expect(confirmTransaction).toHaveBeenCalledWith("airdrop-remainder-sig", "confirmed");
  });

  it("splits large devnet airdrops into 1 SOL chunks", async () => {
    const confirmTransaction = jest.fn();
    const requestAirdrop = jest
      .fn()
      .mockResolvedValueOnce("airdrop-sig-1")
      .mockResolvedValueOnce("airdrop-sig-2");
    const rpcClient = {
      confirmTransaction,
      requestAirdrop
    } as unknown as RpcClient;
    const transactionService = {} as TransactionService;
    const service = new DevnetFundingService(rpcClient, transactionService, null);
    const recipient = Keypair.generate().publicKey;

    const result = await service.fundExactSol({
      amountSol: 1.2,
      recipient
    });

    expect(result).toEqual({
      signature: "airdrop-sig-2",
      source: "airdrop"
    });
    expect(requestAirdrop).toHaveBeenNthCalledWith(1, recipient, 1_000_000_000);
    expect(requestAirdrop).toHaveBeenNthCalledWith(2, recipient, 200_000_000);
    expect(confirmTransaction).toHaveBeenNthCalledWith(1, "airdrop-sig-1", "confirmed");
    expect(confirmTransaction).toHaveBeenNthCalledWith(2, "airdrop-sig-2", "confirmed");
  });
});
