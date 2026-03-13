import { BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction
} from "@solana/web3.js";

const mockAuditManagerInstances: Array<{
  appendAuditEntry: jest.Mock;
  fetchAuditLog: jest.Mock;
}> = [];
const mockProofAnchorInstances: Array<{
  anchorProof: jest.Mock;
}> = [];
const mockProve = jest.fn();
const mockSignEvmTransaction = jest.fn();
const mockProviderCall = jest.fn();
const mockProviderEstimateGas = jest.fn();
const mockProviderBroadcastTransaction = jest.fn();
const mockLoadOrGenerate = jest.fn();
let mockPolicyViolationClass: new (message: string) => Error;

jest.mock("../../src/compression/AuditLogManager", () => ({
  AuditLogManager: jest.fn().mockImplementation(() => {
    const instance = {
      appendAuditEntry: jest.fn(async () => undefined),
      fetchAuditLog: jest.fn(async () => [])
    };
    mockAuditManagerInstances.push(instance);
    return instance;
  })
}));

jest.mock("../../src/zk/ProofAnchor", () => ({
  ProofAnchor: jest.fn().mockImplementation(() => {
    const instance = {
      anchorProof: jest.fn(async () => undefined)
    };
    mockProofAnchorInstances.push(instance);
    return instance;
  })
}));

jest.mock("../../src/zk/PolicyCircuit", () => {
  mockPolicyViolationClass = class PolicyViolation extends Error {
    constructor(message: string) {
      super(message);
      this.name = "PolicyViolation";
    }
  };

  return {
    PolicyCircuit: {
      prove: mockProve
    },
    PolicyViolation: mockPolicyViolationClass
  };
});

jest.mock("../../src/evm/NeonWalletBridge", () => ({
  NeonWalletBridge: jest.fn().mockImplementation(() => ({
    signEvmTransaction: mockSignEvmTransaction
  }))
}));

jest.mock("../../src/core/wallet/WalletManager", () => ({
  WalletManager: {
    loadOrGenerate: mockLoadOrGenerate
  }
}));

jest.mock("ethers", () => {
  const actual = jest.requireActual("ethers");

  class MockJsonRpcProvider {
    constructor(readonly url: string) {}

    call = mockProviderCall;
    estimateGas = mockProviderEstimateGas;
    broadcastTransaction = mockProviderBroadcastTransaction;
  }

  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: MockJsonRpcProvider
    },
    JsonRpcProvider: MockJsonRpcProvider
  };
});

import { defaultPRKTConfig } from "../../src/config/PRKTConfig";
import { SandboxExecutor } from "../../src/policy/sandbox/SandboxExecutor";
import type { PolicyConfig, TxInspectionResult } from "../../src/policy";

function createTransaction(): VersionedTransaction {
  const payer = Keypair.generate();
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      instructions: [],
      payerKey: payer.publicKey,
      recentBlockhash: "11111111111111111111111111111111"
    }).compileToV0Message()
  );
  transaction.sign([payer]);
  return transaction;
}

function createInspectionResult(overrides?: Partial<TxInspectionResult>): TxInspectionResult {
  return {
    allowed: true,
    reasons: [],
    details: {
      totalSolSpendLamports: 0n,
      totalSplSpendRaw: 0n,
      programsSeen: [],
      mintsSeen: []
    },
    ...overrides
  };
}

function createPolicyConfig(overrides?: Partial<PolicyConfig>): PolicyConfig {
  return {
    agentId: "agent-devnet",
    approvalMode: "sandbox",
    limits: {
      maxSolPerTxLamports: 2_000_000_000,
      maxSplPerTxRawAmount: 10_000n,
      maxTransactionsPerSession: 5,
      maxTransactionsPerDay: 10
    },
    rules: {
      allowedProgramIds: [SystemProgram.programId.toBase58()],
      allowedMintAddresses: [],
      denyUnknownInstructionsByDefault: true,
      requireSimulationSuccess: true,
      rejectSuspiciousBalanceDeltas: true
    },
    sessionExpiresAtIso8601: new Date(Date.now() + 30 * 60_000).toISOString(),
    ...overrides
  };
}

function createPolicyEngine(overrides?: Record<string, unknown>) {
  return {
    getAuditTrail: jest.fn(() => []),
    inspect: jest.fn(() => createInspectionResult()),
    inspectEvm: jest.fn(() => createInspectionResult()),
    recordBroadcast: jest.fn(),
    getPolicyConfig: jest.fn(() => createPolicyConfig()),
    getSpentToday: jest.fn(() => 0),
    ...overrides
  };
}

function latestAuditManager() {
  const instance = mockAuditManagerInstances.at(-1);
  if (!instance) {
    throw new Error("expected audit manager instance");
  }

  return instance;
}

function latestProofAnchor() {
  const instance = mockProofAnchorInstances.at(-1);
  if (!instance) {
    throw new Error("expected proof anchor instance");
  }

  return instance;
}

describe("SandboxExecutor", () => {
  const originalCompressionConfig = { ...defaultPRKTConfig.zkCompression };
  const originalProofConfig = { ...defaultPRKTConfig.zkPolicyProofs };
  const originalEvmConfig = { ...defaultPRKTConfig.evmAdapters };
  const originalNeonBroadcastEnabled = process.env.NEON_BROADCAST_ENABLED;

  afterEach(() => {
    defaultPRKTConfig.zkCompression = { ...originalCompressionConfig };
    defaultPRKTConfig.zkPolicyProofs = { ...originalProofConfig };
    defaultPRKTConfig.evmAdapters = { ...originalEvmConfig };
    if (originalNeonBroadcastEnabled === undefined) {
      delete process.env.NEON_BROADCAST_ENABLED;
    } else {
      process.env.NEON_BROADCAST_ENABLED = originalNeonBroadcastEnabled;
    }

    mockAuditManagerInstances.length = 0;
    mockProofAnchorInstances.length = 0;

    jest.clearAllMocks();
  });

  it("returns early when policy inspection blocks the transaction", async () => {
    const inspection = createInspectionResult({
      allowed: false,
      reasons: ["blocked by policy"]
    });
    const policyEngine = createPolicyEngine({
      inspect: jest.fn(() => inspection)
    });
    const transactionService = {
      sendAndConfirm: jest.fn(),
      simulate: jest.fn()
    };
    const executor = new SandboxExecutor(
      policyEngine as never,
      transactionService as never,
      "sandbox"
    );

    const result = await executor.executePreparedTransaction({
      transaction: createTransaction()
    });

    expect(result).toEqual({
      inspection,
      signature: null,
      simulationLogs: null
    });
    expect(transactionService.simulate).not.toHaveBeenCalled();
    expect(transactionService.sendAndConfirm).not.toHaveBeenCalled();
  });

  it("records a rejected compressed audit entry when inspection blocks execution", async () => {
    defaultPRKTConfig.zkCompression.enabled = true;
    mockLoadOrGenerate.mockImplementation(() => {
      throw new Error("no local payer");
    });

    const inspection = createInspectionResult({
      allowed: false,
      reasons: ["blocked by policy"]
    });
    const policyEngine = createPolicyEngine({
      getAuditTrail: jest.fn(() => [{ agentId: "agent-compressed" }]),
      inspect: jest.fn(() => inspection)
    });
    const transactionService = {
      sendAndConfirm: jest.fn(),
      simulate: jest.fn()
    };
    const executor = new SandboxExecutor(
      policyEngine as never,
      transactionService as never,
      "sandbox"
    );
    latestAuditManager().appendAuditEntry.mockRejectedValueOnce(new Error("audit write failed"));

    await executor.executePreparedTransaction({
      transaction: createTransaction()
    });

    expect(latestAuditManager().appendAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-compressed",
        approved: false,
        rejectionReason: "blocked by policy",
        simulationResult: "skipped"
      }),
      expect.any(Keypair)
    );
  });

  it("blocks when simulation fails", async () => {
    const policyEngine = createPolicyEngine();
    const transactionService = {
      sendAndConfirm: jest.fn(),
      simulate: jest.fn(async () => ({
        err: { InstructionError: [0, "Custom"] },
        logs: ["simulation log"],
        unitsConsumed: 123
      }))
    };
    const executor = new SandboxExecutor(
      policyEngine as never,
      transactionService as never,
      "sandbox"
    );

    const result = await executor.executePreparedTransaction({
      transaction: createTransaction()
    });

    expect(result.signature).toBeNull();
    expect(result.simulationLogs).toEqual(["simulation log"]);
    expect(result.inspection.allowed).toBe(false);
    expect(result.inspection.reasons).toContain("simulation failed");
    expect(transactionService.sendAndConfirm).not.toHaveBeenCalled();
  });

  it("records a compressed audit entry when Solana simulation fails", async () => {
    defaultPRKTConfig.zkCompression.enabled = true;

    const policyEngine = createPolicyEngine({
      getAuditTrail: jest.fn(() => [{ agentId: "agent-sim-fail" }])
    });
    const transactionService = {
      sendAndConfirm: jest.fn(),
      simulate: jest.fn(async () => ({
        err: { InstructionError: [0, "Custom"] },
        logs: ["simulation log"],
        unitsConsumed: 123
      }))
    };
    const executor = new SandboxExecutor(
      policyEngine as never,
      transactionService as never,
      "sandbox"
    );
    latestAuditManager().appendAuditEntry.mockRejectedValueOnce(new Error("audit write failed"));

    await executor.executePreparedTransaction({
      transaction: createTransaction(),
      solanaKeypair: Keypair.generate()
    });

    expect(latestAuditManager().appendAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-sim-fail",
        approved: false,
        rejectionReason: "simulation failed",
        simulationResult: "failed"
      }),
      expect.any(Keypair)
    );
  });

  it("blocks live execution when no approval callback is configured", async () => {
    const policyEngine = createPolicyEngine();
    const transactionService = {
      sendAndConfirm: jest.fn(),
      simulate: jest.fn(async () => ({
        err: null,
        logs: ["ok"],
        unitsConsumed: 10
      }))
    };
    const executor = new SandboxExecutor(
      policyEngine as never,
      transactionService as never,
      "live"
    );

    const result = await executor.executePreparedTransaction({
      transaction: createTransaction()
    });

    expect(result.signature).toBeNull();
    expect(result.inspection.allowed).toBe(false);
    expect(result.inspection.reasons).toContain("live approval callback missing");
    expect(transactionService.sendAndConfirm).not.toHaveBeenCalled();
  });

  it("blocks live execution when manual approval is rejected", async () => {
    const approvalCallback = jest.fn(async () => false);
    const policyEngine = createPolicyEngine({
      getAuditTrail: jest.fn(() => [{ agentId: "agent-live" }])
    });
    const transactionService = {
      sendAndConfirm: jest.fn(),
      simulate: jest.fn(async () => ({
        err: null,
        logs: ["ok"],
        unitsConsumed: 10
      }))
    };
    const executor = new SandboxExecutor(
      policyEngine as never,
      transactionService as never,
      "live",
      approvalCallback
    );
    const transaction = createTransaction();

    const result = await executor.executePreparedTransaction({
      transaction
    });

    expect(approvalCallback).toHaveBeenCalledWith({
      agentId: "agent-live",
      inspection: createInspectionResult(),
      transaction
    });
    expect(result.signature).toBeNull();
    expect(result.inspection.allowed).toBe(false);
    expect(result.inspection.reasons).toContain("manual approval rejected");
    expect(transactionService.sendAndConfirm).not.toHaveBeenCalled();
  });

  it("returns a denied result when policy attestation rejects a Solana transaction", async () => {
    defaultPRKTConfig.zkPolicyProofs.enabled = true;
    mockProve.mockRejectedValue(new mockPolicyViolationClass("PROGRAM_NOT_ALLOWED"));

    const policyEngine = createPolicyEngine({
      getPolicyConfig: jest.fn(() =>
        createPolicyConfig({
          rules: {
            ...createPolicyConfig().rules,
            allowedProgramIds: [SystemProgram.programId.toBase58(), "not-a-public-key"]
          }
        })
      )
    });
    const transactionService = {
      sendAndConfirm: jest.fn(),
      simulate: jest.fn(async () => ({
        err: null,
        logs: ["ok"],
        unitsConsumed: 10
      }))
    };
    const executor = new SandboxExecutor(
      policyEngine as never,
      transactionService as never,
      "sandbox"
    );

    const result = await executor.executePreparedTransaction({
      transaction: createTransaction(),
      solanaKeypair: Keypair.generate()
    });

    expect(result.signature).toBeNull();
    expect(result.inspection.allowed).toBe(false);
    expect(result.inspection.reasons).toContain("Policy attestation rejected: PROGRAM_NOT_ALLOWED");
    expect(transactionService.sendAndConfirm).not.toHaveBeenCalled();
  });

  it("rethrows unexpected Solana proof generation failures", async () => {
    defaultPRKTConfig.zkPolicyProofs.enabled = true;
    mockProve.mockRejectedValueOnce(new Error("proof backend offline"));

    const policyEngine = createPolicyEngine();
    const transactionService = {
      sendAndConfirm: jest.fn(),
      simulate: jest.fn(async () => ({
        err: null,
        logs: ["ok"],
        unitsConsumed: 10
      }))
    };
    const executor = new SandboxExecutor(
      policyEngine as never,
      transactionService as never,
      "sandbox"
    );

    await expect(
      executor.executePreparedTransaction({
        transaction: createTransaction(),
        solanaKeypair: Keypair.generate()
      })
    ).rejects.toThrow("proof backend offline");
  });

  it("sends, attests, and records a successful Solana transaction", async () => {
    defaultPRKTConfig.zkCompression.enabled = true;
    defaultPRKTConfig.zkPolicyProofs.enabled = true;

    const proof = {
      attestation: {
        agentId: "agent-proof",
        checks: {
          allowlist: { passed: true, program: "NONE" },
          killSwitch: { active: false, passed: true },
          spendLimit: {
            limitLamports: "2000000000",
            passed: true,
            requestedLamports: "1500000000",
            spentLamports: "1250000000"
          },
          ttl: {
            expiresAt: Date.now() + 60_000,
            now: Date.now(),
            passed: true
          }
        },
        intentHash: "intent-hash",
        policyHash: "policy-hash",
        prover: "PRKT-LOCAL-v1",
        timestamp: Date.now()
      },
      publicKey: Keypair.generate().publicKey.toBase58(),
      signature: Uint8Array.from([1, 2, 3])
    };
    mockProve.mockResolvedValue({
      approved: true,
      proof,
      reason: "policy checks passed"
    });

    const inspection = createInspectionResult({
      details: {
        totalSolSpendLamports: 1_500_000_000n,
        totalSplSpendRaw: 0n,
        programsSeen: [SystemProgram.programId.toBase58()],
        mintsSeen: []
      }
    });
    const policyEngine = createPolicyEngine({
      inspect: jest.fn(() => inspection),
      getAuditTrail: jest.fn(() => [{ agentId: "agent-proof" }]),
      getPolicyConfig: jest.fn(() =>
        createPolicyConfig({
          rules: {
            ...createPolicyConfig().rules,
            allowedProgramIds: [SystemProgram.programId.toBase58(), "invalid-program-id"]
          }
        })
      ),
      getSpentToday: jest.fn(() => 1.25)
    });
    const transactionService = {
      sendAndConfirm: jest.fn(async () => ({
        signature: "tx-signature",
        slot: 99
      })),
      simulate: jest.fn(async () => ({
        err: null,
        logs: ["ok"],
        unitsConsumed: 10
      }))
    };
    const executor = new SandboxExecutor(
      policyEngine as never,
      transactionService as never,
      "sandbox"
    );
    const transaction = createTransaction();
    const solanaKeypair = Keypair.generate();
    latestAuditManager().appendAuditEntry.mockRejectedValueOnce(new Error("audit write failed"));

    const result = await executor.executePreparedTransaction({
      confirmationStrategy: "tx-signature",
      solanaKeypair,
      transaction
    });

    expect(transactionService.sendAndConfirm).toHaveBeenCalledWith({
      confirmationStrategy: "tx-signature",
      transaction
    });
    expect(mockProve).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        agentId: "agent-devnet",
        dailySpendLimit: expect.any(BN),
        programAllowlist: [expect.any(PublicKey)],
        spentToday: expect.any(BN)
      }),
      "EXECUTE",
      1_500_000_000n,
      solanaKeypair
    );
    expect(policyEngine.recordBroadcast).toHaveBeenCalledWith("tx-signature", 1.5);
    expect(latestProofAnchor().anchorProof).toHaveBeenCalledWith(proof, "tx-signature", solanaKeypair);
    expect(latestAuditManager().appendAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-proof",
        approved: true,
        simulationResult: "success",
        txSignature: "tx-signature"
      }),
      solanaKeypair
    );
    expect(result).toEqual({
      inspection,
      signature: "tx-signature",
      simulationLogs: ["ok"],
      zkProof: proof
    });
  });

  it("returns a rejected result when EVM inspection blocks execution", async () => {
    defaultPRKTConfig.zkCompression.enabled = true;
    mockLoadOrGenerate.mockReturnValue({
      payer: Keypair.generate()
    });

    const inspection = createInspectionResult({
      allowed: false,
      reason: "EVM contract not allowed",
      reasons: ["EVM contract not allowed"]
    });
    const policyEngine = createPolicyEngine({
      getAuditTrail: jest.fn(() => [{ agentId: "agent-evm" }]),
      inspectEvm: jest.fn(() => inspection)
    });
    const transactionService = {};
    const executor = new SandboxExecutor(
      policyEngine as never,
      transactionService as never,
      "sandbox"
    );
    latestAuditManager().appendAuditEntry.mockRejectedValueOnce(new Error("audit write failed"));

    const result = await executor.executePreparedEvmTransaction({
      address: "0x1234",
      transaction: {
        to: "0x9999",
        value: 1n
      }
    });

    expect(result).toEqual({
      allowed: false,
      reason: "EVM contract not allowed",
      signature: null
    });
    expect(latestAuditManager().appendAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-evm",
        approved: false,
        simulationResult: "skipped"
      }),
      expect.any(Keypair)
    );
  });

  it("returns a rejected result when EVM simulation fails", async () => {
    defaultPRKTConfig.zkCompression.enabled = true;
    mockProviderCall.mockRejectedValueOnce(new Error("eth_call reverted"));

    const policyEngine = createPolicyEngine({
      getAuditTrail: jest.fn(() => [{ agentId: "agent-evm-fail" }])
    });
    const transactionService = {};
    const executor = new SandboxExecutor(
      policyEngine as never,
      transactionService as never,
      "sandbox"
    );
    latestAuditManager().appendAuditEntry.mockRejectedValueOnce(new Error("audit write failed"));

    const result = await executor.executePreparedEvmTransaction({
      address: "0x1234",
      transaction: {
        to: "0x9999",
        value: 10n
      }
    });

    expect(result).toEqual({
      allowed: false,
      reason: "eth_call reverted",
      signature: null
    });
    expect(latestAuditManager().appendAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-evm-fail",
        approved: false,
        rejectionReason: "eth_call reverted",
        simulationResult: "failed"
      }),
      expect.any(Keypair)
    );
  });

  it("blocks live EVM execution when approval is missing or rejected", async () => {
    mockProviderCall.mockResolvedValue("0x");
    mockProviderEstimateGas.mockResolvedValue(21_000n);

    const policyEngine = createPolicyEngine({
      getAuditTrail: jest.fn(() => [{ agentId: "agent-evm-live" }])
    });
    const transactionService = {};
    const noApprovalExecutor = new SandboxExecutor(
      policyEngine as never,
      transactionService as never,
      "live"
    );
    const approvalCallback = jest.fn(async () => false);
    const rejectedExecutor = new SandboxExecutor(
      policyEngine as never,
      transactionService as never,
      "live",
      approvalCallback
    );

    const missingApproval = await noApprovalExecutor.executePreparedEvmTransaction({
      address: "0x1234",
      transaction: {
        to: "0x9999",
        value: 10n
      }
    });
    const rejected = await rejectedExecutor.executePreparedEvmTransaction({
      address: "0x1234",
      transaction: {
        to: "0x9999",
        value: 10n
      }
    });

    expect(missingApproval).toEqual({
      allowed: false,
      reason: "live approval callback missing",
      signature: null
    });
    expect(rejected).toEqual({
      allowed: false,
      reason: "manual approval rejected",
      signature: null
    });
    expect(approvalCallback).toHaveBeenCalled();
  });

  it("fails closed when Neon broadcast is disabled", async () => {
    delete process.env.NEON_BROADCAST_ENABLED;
    mockProviderCall.mockResolvedValue("0x");
    mockProviderEstimateGas.mockResolvedValue(21_000n);

    const policyEngine = createPolicyEngine({
      getAuditTrail: jest.fn(() => [{ agentId: "agent-evm-disabled" }])
    });
    const executor = new SandboxExecutor(
      policyEngine as never,
      {} as never,
      "sandbox"
    );

    const result = await executor.executePreparedEvmTransaction({
      address: "0x1234",
      solanaKeypair: Keypair.generate(),
      transaction: {
        to: "0x9999",
        value: 100n
      }
    });

    expect(result).toEqual({
      allowed: false,
      reason: "NEON_BROADCAST_DISABLED",
      signature: null
    });
    expect(mockSignEvmTransaction).not.toHaveBeenCalled();
    expect(mockProviderBroadcastTransaction).not.toHaveBeenCalled();
  });

  it("returns a denied result when EVM policy attestation rejects execution", async () => {
    process.env.NEON_BROADCAST_ENABLED = "1";
    defaultPRKTConfig.zkPolicyProofs.enabled = true;
    mockProviderCall.mockResolvedValue("0x");
    mockProviderEstimateGas.mockResolvedValue(21_000n);
    mockProve.mockRejectedValueOnce(new mockPolicyViolationClass("SESSION_TTL_EXPIRED"));

    const policyEngine = createPolicyEngine();
    const transactionService = {};
    const executor = new SandboxExecutor(
      policyEngine as never,
      transactionService as never,
      "sandbox"
    );

    const result = await executor.executePreparedEvmTransaction({
      address: "0x1234",
      transaction: {
        to: "0x9999",
        value: 100n
      }
    });

    expect(result).toEqual({
      allowed: false,
      reason: "SESSION_TTL_EXPIRED",
      signature: null
    });
    expect(mockSignEvmTransaction).not.toHaveBeenCalled();
  });

  it("rethrows unexpected EVM proof generation failures", async () => {
    process.env.NEON_BROADCAST_ENABLED = "1";
    defaultPRKTConfig.zkPolicyProofs.enabled = true;
    mockProviderCall.mockResolvedValue("0x");
    mockProviderEstimateGas.mockResolvedValue(21_000n);
    mockProve.mockRejectedValueOnce(new Error("evm proof backend offline"));

    const policyEngine = createPolicyEngine();
    const transactionService = {};
    const executor = new SandboxExecutor(
      policyEngine as never,
      transactionService as never,
      "sandbox"
    );

    await expect(
      executor.executePreparedEvmTransaction({
        address: "0x1234",
        transaction: {
          to: "0x9999",
          value: 100n
        }
      })
    ).rejects.toThrow("evm proof backend offline");
  });

  it("signs, attests, and records a successful EVM execution", async () => {
    process.env.NEON_BROADCAST_ENABLED = "1";
    defaultPRKTConfig.zkCompression.enabled = true;
    defaultPRKTConfig.zkPolicyProofs.enabled = true;
    mockProviderCall.mockResolvedValue("0x");
    mockProviderEstimateGas.mockResolvedValue(21_000n);
    mockSignEvmTransaction.mockResolvedValue("evm-signature");
    mockProviderBroadcastTransaction.mockResolvedValue({
      hash: "0xneonhash",
      wait: jest.fn(async () => ({ status: 1 }))
    });

    const proof = {
      attestation: {
        agentId: "agent-devnet",
        checks: {
          allowlist: { passed: true, program: "NONE" },
          killSwitch: { active: false, passed: true },
          spendLimit: {
            limitLamports: "2000000000",
            passed: true,
            requestedLamports: "500",
            spentLamports: "0"
          },
          ttl: {
            expiresAt: Date.now() + 60_000,
            now: Date.now(),
            passed: true
          }
        },
        intentHash: "intent-hash",
        policyHash: "policy-hash",
        prover: "PRKT-LOCAL-v1",
        timestamp: Date.now()
      },
      publicKey: Keypair.generate().publicKey.toBase58(),
      signature: Uint8Array.from([4, 5, 6])
    };
    mockProve.mockResolvedValueOnce({
      approved: true,
      proof,
      reason: "policy checks passed"
    });

    const inspection = createInspectionResult({
      details: {
        totalSolSpendLamports: 500n,
        totalSplSpendRaw: 0n,
        programsSeen: ["0x9999"],
        mintsSeen: []
      }
    });
    const policyEngine = createPolicyEngine({
      getAuditTrail: jest.fn(() => [{ agentId: "agent-evm-success" }]),
      inspectEvm: jest.fn(() => inspection)
    });
    const transactionService = {};
    const executor = new SandboxExecutor(
      policyEngine as never,
      transactionService as never,
      "sandbox"
    );
    const solanaKeypair = Keypair.generate();
    const transaction = {
      to: "0x9999",
      value: 500n,
      gasLimit: 21_000n
    };

    const result = await executor.executePreparedEvmTransaction({
      address: "0x1234",
      solanaKeypair,
      transaction
    });

    expect(mockProviderCall).toHaveBeenCalledWith({
      ...transaction,
      from: "0x1234"
    });
    expect(mockProviderEstimateGas).toHaveBeenCalledWith({
      ...transaction,
      from: "0x1234"
    });
    expect(mockProve).toHaveBeenCalledWith(
      {
        address: "0x1234",
        transaction: {
          gasLimit: "21000",
          to: "0x9999",
          value: "500"
        }
      },
      expect.objectContaining({
        agentId: "agent-devnet",
        programAllowlist: []
      }),
      "EXECUTE_EVM",
      500n,
      solanaKeypair
    );
    expect(mockSignEvmTransaction).toHaveBeenCalledWith(
      {
        ...transaction,
        from: "0x1234"
      },
      solanaKeypair
    );
    expect(mockProviderBroadcastTransaction).toHaveBeenCalledWith("evm-signature");
    expect(policyEngine.recordBroadcast).toHaveBeenCalledWith("0xneonhash", 5e-7);
    expect(latestProofAnchor().anchorProof).toHaveBeenCalledWith(proof, "0xneonhash", solanaKeypair);
    expect(latestAuditManager().appendAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-evm-success",
        approved: true,
        simulationResult: "success",
        txSignature: "0xneonhash"
      }),
      solanaKeypair
    );
    expect(result).toEqual({
      allowed: true,
      signature: "0xneonhash",
      zkProof: proof
    });
  });
});
