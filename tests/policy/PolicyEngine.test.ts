import {
  AuthorityType,
  createApproveInstruction,
  createCloseAccountInstruction,
  createRevokeInstruction,
  createSetAuthorityInstruction,
  createTransferCheckedInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction
} from "@solana/web3.js";

import { PolicyEngine } from "../../src/policy/engine/PolicyEngine";
import { createDefaultPolicyConfig } from "../../src/config/agentPolicies";
import { ethers } from "ethers";

function createTransferTransaction(lamports: number): VersionedTransaction {
  const payer = Keypair.generate();
  const recipient = Keypair.generate();
  const instruction = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: recipient.publicKey,
    lamports
  });

  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [instruction]
  }).compileToV0Message();

  return new VersionedTransaction(message);
}

function createSplTransferTransaction(input: {
  mint: PublicKey;
  destinationOwner?: PublicKey;
  checked: boolean;
}): VersionedTransaction {
  const owner = Keypair.generate();
  const destinationOwner = input.destinationOwner ?? Keypair.generate().publicKey;
  const sourceAta = getAssociatedTokenAddressSync(input.mint, owner.publicKey);
  const destinationAta = getAssociatedTokenAddressSync(input.mint, destinationOwner);

  const instruction: TransactionInstruction = input.checked
    ? createTransferCheckedInstruction(
      sourceAta,
      input.mint,
      destinationAta,
      owner.publicKey,
      1_000n,
      6
    )
    : createTransferInstruction(sourceAta, destinationAta, owner.publicKey, 1_000n);

  const message = new TransactionMessage({
    payerKey: owner.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [instruction]
  }).compileToV0Message();

  const transaction = new VersionedTransaction(message);
  transaction.sign([owner]);
  return transaction;
}

function createApproveTransaction(): VersionedTransaction {
  const owner = Keypair.generate();
  const tokenAccount = Keypair.generate().publicKey;
  const delegate = Keypair.generate().publicKey;
  const instruction = createApproveInstruction(tokenAccount, delegate, owner.publicKey, 50n);

  const message = new TransactionMessage({
    payerKey: owner.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [instruction]
  }).compileToV0Message();

  return new VersionedTransaction(message);
}

function createCloseAccountTransaction(): VersionedTransaction {
  const authority = Keypair.generate();
  const tokenAccount = Keypair.generate().publicKey;
  const destination = Keypair.generate().publicKey;
  const instruction = createCloseAccountInstruction(tokenAccount, destination, authority.publicKey);

  const message = new TransactionMessage({
    payerKey: authority.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [instruction]
  }).compileToV0Message();

  return new VersionedTransaction(message);
}

function createCloseAccountTransactionToDestination(destination: PublicKey): VersionedTransaction {
  const authority = Keypair.generate();
  const tokenAccount = Keypair.generate().publicKey;
  const instruction = createCloseAccountInstruction(tokenAccount, destination, authority.publicKey);

  const message = new TransactionMessage({
    payerKey: authority.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [instruction]
  }).compileToV0Message();

  return new VersionedTransaction(message);
}

function createRevokeTransaction(): VersionedTransaction {
  const owner = Keypair.generate();
  const tokenAccount = Keypair.generate().publicKey;
  const instruction = createRevokeInstruction(tokenAccount, owner.publicKey);

  const message = new TransactionMessage({
    payerKey: owner.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [instruction]
  }).compileToV0Message();

  return new VersionedTransaction(message);
}

function createSetAuthorityTransaction(authorityType: AuthorityType): VersionedTransaction {
  const authority = Keypair.generate();
  const tokenAccount = Keypair.generate().publicKey;
  const newAuthority = Keypair.generate().publicKey;
  const instruction = createSetAuthorityInstruction(
    tokenAccount,
    authority.publicKey,
    authorityType,
    newAuthority
  );

  const message = new TransactionMessage({
    payerKey: authority.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [instruction]
  }).compileToV0Message();

  return new VersionedTransaction(message);
}

function createOpaqueInstructionTransaction(programId: PublicKey): VersionedTransaction {
  const payer = Keypair.generate();
  const instruction = new TransactionInstruction({
    data: Buffer.from([1, 2, 3]),
    keys: [],
    programId
  });

  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [instruction]
  }).compileToV0Message();

  return new VersionedTransaction(message);
}

describe("PolicyEngine", () => {
  it("blocks tx that exceed max SOL per tx", () => {
    const engine = new PolicyEngine(
      createDefaultPolicyConfig({
        agentId: "agent-a",
        maxSolPerTxLamports: 100_000
      })
    );

    const inspection = engine.inspect(createTransferTransaction(200_000));
    expect(inspection.allowed).toBe(false);
    expect(inspection.reasons.some((reason) => reason.includes("max SOL per transaction"))).toBe(true);
  });

  it("allows checked SPL transfers when the mint is allowlisted", () => {
    const mint = Keypair.generate().publicKey;
    const destinationOwner = Keypair.generate().publicKey;
    const destinationAta = getAssociatedTokenAddressSync(mint, destinationOwner);
    const engine = new PolicyEngine(
      createDefaultPolicyConfig({
        agentId: "agent-spl-checked",
        allowedMints: [mint.toBase58()],
        allowedTransferDestinations: [destinationAta.toBase58()]
      })
    );

    const inspection = engine.inspect(
      createSplTransferTransaction({
        mint,
        destinationOwner,
        checked: true
      })
    );

    expect(inspection.allowed).toBe(true);
    expect(inspection.reasons).toHaveLength(0);
    expect(inspection.details.mintsSeen).toEqual([mint.toBase58()]);
  });

  it("blocks unchecked SPL transfers when a mint allowlist is configured", () => {
    const mint = Keypair.generate().publicKey;
    const destinationOwner = Keypair.generate().publicKey;
    const destinationAta = getAssociatedTokenAddressSync(mint, destinationOwner);
    const engine = new PolicyEngine(
      createDefaultPolicyConfig({
        agentId: "agent-spl-unchecked",
        allowedMints: [mint.toBase58()],
        allowedTransferDestinations: [destinationAta.toBase58()]
      })
    );

    const inspection = engine.inspect(
      createSplTransferTransaction({
        mint,
        destinationOwner,
        checked: false
      })
    );

    expect(inspection.allowed).toBe(false);
    expect(
      inspection.reasons.some((reason) =>
        reason.includes("unchecked SPL transfer cannot be validated against mint allowlist")
      )
    ).toBe(true);
  });

  it("blocks delegate approvals by default", () => {
    const engine = new PolicyEngine(
      createDefaultPolicyConfig({
        agentId: "agent-approve"
      })
    );

    const inspection = engine.inspect(createApproveTransaction());

    expect(inspection.allowed).toBe(false);
    expect(inspection.reasons.some((reason) => reason.includes("delegate approval blocked"))).toBe(true);
  });

  it("blocks close-account drains by default", () => {
    const engine = new PolicyEngine(
      createDefaultPolicyConfig({
        agentId: "agent-close"
      })
    );

    const inspection = engine.inspect(createCloseAccountTransaction());

    expect(inspection.allowed).toBe(false);
    expect(inspection.reasons.some((reason) => reason.includes("close-account drain blocked"))).toBe(true);
  });

  it("allows close-account refunds to explicitly allowlisted destinations", () => {
    const destination = Keypair.generate().publicKey;
    const engine = new PolicyEngine(
      createDefaultPolicyConfig({
        agentId: "agent-close-allowlisted",
        allowedCloseAccountDestinations: [destination.toBase58()]
      })
    );

    const inspection = engine.inspect(createCloseAccountTransactionToDestination(destination));

    expect(inspection.allowed).toBe(true);
    expect(inspection.reasons).toHaveLength(0);
  });

  it("blocks opaque instructions unless explicitly allowlisted", () => {
    const opaqueProgram = Keypair.generate().publicKey;
    const engine = new PolicyEngine(
      createDefaultPolicyConfig({
        agentId: "agent-opaque",
        extraAllowedProgramIds: [opaqueProgram.toBase58()]
      })
    );

    const blockedInspection = engine.inspect(createOpaqueInstructionTransaction(opaqueProgram));
    expect(blockedInspection.allowed).toBe(false);
    expect(blockedInspection.reasons.some((reason) => reason.includes("opaque instruction blocked"))).toBe(true);

    const explicitlyAllowedEngine = new PolicyEngine({
      ...createDefaultPolicyConfig({
        agentId: "agent-opaque-allowed",
        extraAllowedProgramIds: [opaqueProgram.toBase58()]
      }),
      rules: {
        ...createDefaultPolicyConfig({
          agentId: "agent-opaque-allowed",
          extraAllowedProgramIds: [opaqueProgram.toBase58()]
        }).rules,
        allowOpaqueProgramIds: [opaqueProgram.toBase58()]
      }
    });

    const allowedInspection = explicitlyAllowedEngine.inspect(
      createOpaqueInstructionTransaction(opaqueProgram)
    );
    expect(allowedInspection.allowed).toBe(true);
  });

  it("blocks expired sessions", () => {
    const engine = new PolicyEngine({
      ...createDefaultPolicyConfig({
        agentId: "agent-expired"
      }),
      sessionExpiresAtIso8601: new Date(Date.now() - 60_000).toISOString()
    });

    const inspection = engine.inspect(createTransferTransaction(1));

    expect(inspection.allowed).toBe(false);
    expect(inspection.reasons).toContain("session expired");
  });

  it("blocks transactions when the emergency lock is engaged", () => {
    const originalEmergencyLock = process.env.POLICY_EMERGENCY_LOCK;
    process.env.POLICY_EMERGENCY_LOCK = "true";

    try {
      const engine = new PolicyEngine(
        createDefaultPolicyConfig({
          agentId: "agent-locked"
        })
      );

      const inspection = engine.inspect(createTransferTransaction(1));

      expect(inspection.allowed).toBe(false);
      expect(
        inspection.reasons.some((reason) => reason.includes("Human-in-the-loop Override engaged"))
      ).toBe(true);
    } finally {
      if (originalEmergencyLock === undefined) {
        delete process.env.POLICY_EMERGENCY_LOCK;
      } else {
        process.env.POLICY_EMERGENCY_LOCK = originalEmergencyLock;
      }
    }
  });

  it("blocks transactions once the per-session limit is reached", () => {
    const engine = new PolicyEngine(
      createDefaultPolicyConfig({
        agentId: "agent-session-limit",
        maxTransactionsPerSession: 1
      })
    );

    engine.recordBroadcast("sig-session");
    const inspection = engine.inspect(createTransferTransaction(1));

    expect(inspection.allowed).toBe(false);
    expect(inspection.reasons).toContain("max transactions per session exceeded");
  });

  it("blocks transactions once the per-day limit is reached", () => {
    const engine = new PolicyEngine(
      createDefaultPolicyConfig({
        agentId: "agent-day-limit",
        maxTransactionsPerDay: 1
      })
    );

    engine.recordBroadcast("sig-day");
    const inspection = engine.inspect(createTransferTransaction(1));

    expect(inspection.allowed).toBe(false);
    expect(inspection.reasons).toContain("max transactions per day exceeded");
  });

  it("rejects invalid expected balance deltas", () => {
    const engine = new PolicyEngine(
      createDefaultPolicyConfig({
        agentId: "agent-balance-delta"
      })
    );
    const account = Keypair.generate().publicKey;

    const inspection = engine.inspect(createTransferTransaction(1), {
      expectedBalanceDeltas: [
        {
          account,
          maxNegativeDeltaRaw: -1n
        }
      ]
    });

    expect(inspection.allowed).toBe(false);
    expect(inspection.reasons).toContain("invalid expected balance delta");
  });

  it("blocks delegate revokes by default", () => {
    const engine = new PolicyEngine(
      createDefaultPolicyConfig({
        agentId: "agent-revoke"
      })
    );

    const inspection = engine.inspect(createRevokeTransaction());

    expect(inspection.allowed).toBe(false);
    expect(
      inspection.reasons.some((reason) => reason.includes("delegate revoke requires explicit approval"))
    ).toBe(true);
  });

  it("blocks account-owner authority changes by default", () => {
    const engine = new PolicyEngine(
      createDefaultPolicyConfig({
        agentId: "agent-authority"
      })
    );

    const inspection = engine.inspect(createSetAuthorityTransaction(AuthorityType.AccountOwner));

    expect(inspection.allowed).toBe(false);
    expect(inspection.reasons.some((reason) => reason.includes("authority change blocked"))).toBe(true);
  });

  it("records audit trail entries for inspections and broadcasts", () => {
    const engine = new PolicyEngine(
      createDefaultPolicyConfig({
        agentId: "agent-audit"
      })
    );

    engine.inspect(createTransferTransaction(1));
    engine.recordBroadcast("sig-audit");

    const auditTrail = engine.getAuditTrail();

    expect(auditTrail).toHaveLength(2);
    expect(auditTrail[0]?.decision).toBe("allow");
    expect(auditTrail[1]).toMatchObject({
      decision: "allow",
      reason: "broadcasted",
      txSignature: "sig-audit"
    });
    expect(engine.getSessionAgeMs()).toBeGreaterThanOrEqual(0);
  });

  describe("Cross-Chain (EVM) Limits", () => {
    it("rejects an EVM transaction (Uniswap) if the total daily spend exceeds the shared limit after an SVM transaction (Jupiter)", () => {
      const engine = new PolicyEngine(
        createDefaultPolicyConfig({
          agentId: "agent-crosschain",
          maxSolPerTxLamports: 2_000_000_000,
          maxTransactionsPerDay: 10,
          extraAllowedProgramIds: ["0xMockUniswapRouter"]
        })
      );

      const jupiterTx = createTransferTransaction(1_500_000_000);
      const svmInspection = engine.inspect(jupiterTx);
      expect(svmInspection.allowed).toBe(true);
      engine.recordBroadcast("sig-svm-jupiter", 1.5);

      const evmTx = {
        to: "0xMockUniswapRouter",
        value: 600_000_000n,
      } as ethers.TransactionRequest;

      const evmInspection = engine.inspectEvm(evmTx);
      expect(evmInspection.allowed).toBe(false);
      expect(evmInspection.reason).toBe("DAILY_LIMIT_EXCEEDED");
      expect(evmInspection.reasons).toContain("DAILY_LIMIT_EXCEEDED");

      const heavyEvmTx = {
        to: "0xMockUniswapRouter",
        value: 2_100_000_000n,
      } as ethers.TransactionRequest;

      const heavyEvmInspection = engine.inspectEvm(heavyEvmTx);
      expect(heavyEvmInspection.allowed).toBe(false);
      expect(heavyEvmInspection.reasons).toContain("max spend per transaction exceeded");
    });

    it("allows EVM tx when combined spend is under limit", () => {
      const engine = new PolicyEngine(
        createDefaultPolicyConfig({
          agentId: "agent-crosschain-under-limit",
          maxSolPerTxLamports: 2_000_000_000,
          extraAllowedProgramIds: ["0xMockUniswapRouter"]
        })
      );

      const jupiterTx = createTransferTransaction(500_000_000);
      const svmInspection = engine.inspect(jupiterTx);
      expect(svmInspection.allowed).toBe(true);
      engine.recordBroadcast("sig-svm-safe", 0.5);

      const evmInspection = engine.inspectEvm({
        to: "0xMockUniswapRouter",
        value: 300_000_000n
      } as ethers.TransactionRequest);

      expect(evmInspection.allowed).toBe(true);
      expect(evmInspection.reason).toBeUndefined();
    });

    it("should reset spend counter at UTC midnight", () => {
      const nowSpy = jest.spyOn(Date, "now");
      const dayOne = new Date("2026-03-11T23:55:00.000Z").valueOf();
      const dayTwo = new Date("2026-03-12T00:05:00.000Z").valueOf();

      try {
        nowSpy.mockReturnValue(dayOne);
        const engine = new PolicyEngine(
          createDefaultPolicyConfig({
            agentId: "agent-reset-midnight",
            maxSolPerTxLamports: 2_000_000_000,
            extraAllowedProgramIds: ["0xMockUniswapRouter"]
          })
        );

        engine.recordSpend(1.8);
        expect(engine.getSpentToday()).toBeCloseTo(1.8, 5);

        nowSpy.mockReturnValue(dayTwo);
        expect(engine.getSpentToday()).toBe(0);

        const evmInspection = engine.inspectEvm({
          to: "0xMockUniswapRouter",
          value: 300_000_000n
        } as ethers.TransactionRequest);
        expect(evmInspection.allowed).toBe(true);
      } finally {
        nowSpy.mockRestore();
      }
    });
  });
});
