import {
  createApproveInstruction,
  createCloseAccountInstruction,
  createTransferInstruction
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction
} from "@solana/web3.js";

import { PolicyGuard } from "../../src/policy/PolicyGuard";
import { SecurityViolationError } from "../../src/policy/errors";
import { TOKEN_PROGRAM_ID } from "../../src/solana/programs";
import type { PolicyConstraints } from "../../src/types/policy";

function createPolicy(overrides?: Partial<PolicyConstraints>): PolicyConstraints {
  return {
    protocolPolicies: {},
    maxSpend: { lamports: 2_000_000 },
    whitelistedPrograms: [SystemProgram.programId.toBase58()],
    sessionExpiry: { iso8601: "2099-01-01T00:00:00.000Z" },
    whitelistedTransferDestinations: [],
    ...overrides
  };
}

function createTransferTransaction(destination: string, lamports: number): VersionedTransaction {
  const payer = Keypair.generate();
  const transferInstruction = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: new PublicKey(destination),
    lamports
  });

  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [transferInstruction]
  }).compileToV0Message();

  return new VersionedTransaction(message);
}

function createSplTransferTransaction(destination: PublicKey, amount: bigint): VersionedTransaction {
  const owner = Keypair.generate();
  const sourceTokenAccount = Keypair.generate().publicKey;
  const transferInstruction = createTransferInstruction(
    sourceTokenAccount,
    destination,
    owner.publicKey,
    amount
  );

  const message = new TransactionMessage({
    payerKey: owner.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [transferInstruction]
  }).compileToV0Message();

  return new VersionedTransaction(message);
}

function createSplApproveTransaction(delegate: PublicKey): VersionedTransaction {
  const owner = Keypair.generate();
  const tokenAccount = Keypair.generate().publicKey;
  const approveInstruction = createApproveInstruction(
    tokenAccount,
    delegate,
    owner.publicKey,
    500n
  );

  const message = new TransactionMessage({
    payerKey: owner.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [approveInstruction]
  }).compileToV0Message();

  return new VersionedTransaction(message);
}

function createCloseAccountTransaction(destination: PublicKey): VersionedTransaction {
  const authority = Keypair.generate();
  const tokenAccount = Keypair.generate().publicKey;
  const closeInstruction = createCloseAccountInstruction(
    tokenAccount,
    destination,
    authority.publicKey
  );

  const message = new TransactionMessage({
    payerKey: authority.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [closeInstruction]
  }).compileToV0Message();

  return new VersionedTransaction(message);
}

describe("PolicyGuard", () => {
  const originalEmergencyLockFlag = process.env.POLICY_EMERGENCY_LOCK;

  afterEach(() => {
    if (originalEmergencyLockFlag === undefined) {
      delete process.env.POLICY_EMERGENCY_LOCK;
    } else {
      process.env.POLICY_EMERGENCY_LOCK = originalEmergencyLockFlag;
    }
  });

  it("blocks a malicious transfer to a non-whitelisted destination", () => {
    const recipient = Keypair.generate().publicKey.toBase58();
    const guard = new PolicyGuard(createPolicy());
    const transaction = createTransferTransaction(recipient, 1_000_000);

    expect(() => guard.validate(transaction)).toThrow(SecurityViolationError);
    expect(() => guard.validate(transaction)).toThrow("destination");
  });

  it("allows a whitelisted transfer within max spend", () => {
    const recipient = Keypair.generate().publicKey.toBase58();
    const guard = new PolicyGuard(
      createPolicy({
        whitelistedTransferDestinations: [recipient]
      })
    );
    const transaction = createTransferTransaction(recipient, 1_000_000);

    expect(() => guard.validate(transaction)).not.toThrow();
  });

  it("blocks transfers that exceed max spend", () => {
    const recipient = Keypair.generate().publicKey.toBase58();
    const guard = new PolicyGuard(
      createPolicy({
        maxSpend: { lamports: 100_000 },
        whitelistedTransferDestinations: [recipient]
      })
    );
    const transaction = createTransferTransaction(recipient, 1_000_000);

    expect(() => guard.validate(transaction)).toThrow("exceeds max spend");
  });

  it("blocks all transactions when the human override flag is enabled", () => {
    process.env.POLICY_EMERGENCY_LOCK = "true";

    const recipient = Keypair.generate().publicKey.toBase58();
    const guard = new PolicyGuard(
      createPolicy({
        whitelistedTransferDestinations: [recipient]
      })
    );
    const transaction = createTransferTransaction(recipient, 10_000);

    expect(() => guard.validate(transaction)).toThrow(SecurityViolationError);
    expect(() => guard.validate(transaction)).toThrow("Human-in-the-loop Override");
  });

  it("blocks SPL token transfers to non-whitelisted destinations", () => {
    const destinationTokenAccount = Keypair.generate().publicKey;
    const guard = new PolicyGuard(
      createPolicy({
        whitelistedPrograms: [
          SystemProgram.programId.toBase58(),
          TOKEN_PROGRAM_ID.toBase58()
        ]
      })
    );
    const transaction = createSplTransferTransaction(destinationTokenAccount, 10_000n);

    expect(() => guard.validate(transaction)).toThrow(SecurityViolationError);
    expect(() => guard.validate(transaction)).toThrow("destination");
  });

  it("blocks SPL token transfers that exceed max spend", () => {
    const destinationTokenAccount = Keypair.generate().publicKey;
    const guard = new PolicyGuard(
      createPolicy({
        maxSpend: { lamports: 100 },
        whitelistedPrograms: [
          SystemProgram.programId.toBase58(),
          TOKEN_PROGRAM_ID.toBase58()
        ],
        whitelistedTransferDestinations: [destinationTokenAccount.toBase58()]
      })
    );
    const transaction = createSplTransferTransaction(destinationTokenAccount, 1_000n);

    expect(() => guard.validate(transaction)).toThrow("exceeds max spend");
  });

  it("allows SPL token transfers when destination and spend are within policy", () => {
    const destinationTokenAccount = Keypair.generate().publicKey;
    const guard = new PolicyGuard(
      createPolicy({
        maxSpend: { lamports: 2_000 },
        whitelistedPrograms: [
          SystemProgram.programId.toBase58(),
          TOKEN_PROGRAM_ID.toBase58()
        ],
        whitelistedTransferDestinations: [destinationTokenAccount.toBase58()]
      })
    );
    const transaction = createSplTransferTransaction(destinationTokenAccount, 1_000n);

    expect(() => guard.validate(transaction)).not.toThrow();
  });

  it("blocks SPL delegate approvals", () => {
    const delegate = Keypair.generate().publicKey;
    const guard = new PolicyGuard(
      createPolicy({
        whitelistedPrograms: [TOKEN_PROGRAM_ID.toBase58()]
      })
    );

    expect(() => guard.validate(createSplApproveTransaction(delegate))).toThrow("Delegate approval");
  });

  it("blocks close-account drains", () => {
    const destination = Keypair.generate().publicKey;
    const guard = new PolicyGuard(
      createPolicy({
        whitelistedPrograms: [TOKEN_PROGRAM_ID.toBase58()]
      })
    );

    expect(() => guard.validate(createCloseAccountTransaction(destination))).toThrow("Close-account drain");
  });
});
