import { createHash, randomBytes } from "crypto";

import {
  Ed25519Program,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  TransactionInstruction
} from "@solana/web3.js";

import { getOnchainPolicyGuardProgramId } from "../config/env";

const DEFAULT_POLICY_GUARD_PROGRAM_ID = new PublicKey("3sUkfLW4jtwSQFgdtWyEj8FPedtvKfXSB1J16PMUZhMG");
const POLICY_SEED = Buffer.from("policy", "utf8");
const SESSION_SEED = Buffer.from("session", "utf8");
const VAULT_SEED = Buffer.from("vault", "utf8");
const EXECUTE_TRANSFER_OPCODE = 4;
const EXECUTE_TRANSFER_PAYLOAD_SIZE = 160;
const POLICY_STATE_HEADER_SIZE = 100;

export type InitializePolicyInput = {
  owner: PublicKey;
  verifier: PublicKey;
  dailySpendLimitLamports: bigint;
  sessionTtlMinutes: number;
  allowedPrograms?: PublicKey[];
  allowedRecipients?: PublicKey[];
  programId?: PublicKey;
};

export type SessionInstructionInput = {
  owner: PublicKey;
  sessionId: Uint8Array;
  programId?: PublicKey;
};

export type ManagedTransferInput = {
  amountLamports: bigint;
  nonce: bigint;
  policyOwner: PublicKey;
  recipient: PublicKey;
  sessionId: Uint8Array;
  signer: Keypair | Uint8Array;
  expiresAtUnix: number;
  timestampUnix?: number;
  targetProgram?: PublicKey;
  intentHash?: Uint8Array;
  programId?: PublicKey;
};

export type ManagedTransferPayload = {
  amountLamports: bigint;
  expiresAtUnix: number;
  intentHash: Buffer;
  nonce: bigint;
  recipient: PublicKey;
  sessionId: Buffer;
  targetProgram: PublicKey;
  timestampUnix: number;
};

export function resolvePolicyGuardProgramId(programId?: PublicKey): PublicKey {
  if (programId) {
    return programId;
  }

  const configured = getOnchainPolicyGuardProgramId();
  return configured ? new PublicKey(configured) : DEFAULT_POLICY_GUARD_PROGRAM_ID;
}

export function createSessionId(seed?: string | Uint8Array): Buffer {
  if (!seed) {
    return randomBytes(32);
  }

  const source = typeof seed === "string" ? Buffer.from(seed, "utf8") : Buffer.from(seed);
  return createHash("sha256").update(source).digest();
}

export function getPolicyStateSpace(input: {
  allowedPrograms?: PublicKey[];
  allowedRecipients?: PublicKey[];
}): number {
  const allowedPrograms = input.allowedPrograms ?? [];
  const allowedRecipients = input.allowedRecipients ?? [];
  return POLICY_STATE_HEADER_SIZE + (allowedPrograms.length + allowedRecipients.length) * 32;
}

export function findPolicyPda(owner: PublicKey, programId?: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [POLICY_SEED, owner.toBuffer()],
    resolvePolicyGuardProgramId(programId)
  );
}

export function findVaultPda(policyPda: PublicKey, programId?: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, policyPda.toBuffer()],
    resolvePolicyGuardProgramId(programId)
  );
}

export function findSessionPda(
  policyPda: PublicKey,
  sessionId: Uint8Array,
  programId?: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SESSION_SEED, policyPda.toBuffer(), toFixedBuffer(sessionId, 32)],
    resolvePolicyGuardProgramId(programId)
  );
}

export function buildInitializePolicyInstruction(input: InitializePolicyInput): {
  instruction: TransactionInstruction;
  policyPda: PublicKey;
  vaultPda: PublicKey;
} {
  const programId = resolvePolicyGuardProgramId(input.programId);
  const allowedPrograms = input.allowedPrograms ?? [];
  const allowedRecipients = input.allowedRecipients ?? [];
  const [policyPda] = findPolicyPda(input.owner, programId);
  const [vaultPda] = findVaultPda(policyPda, programId);

  const data = Buffer.concat([
    Buffer.from([0]),
    encodeU32(input.sessionTtlMinutes),
    encodeU64(input.dailySpendLimitLamports),
    input.verifier.toBuffer(),
    encodePubkeyArray(allowedPrograms),
    encodePubkeyArray(allowedRecipients)
  ]);

  return {
    instruction: new TransactionInstruction({
      programId,
      keys: [
        { pubkey: input.owner, isSigner: true, isWritable: true },
        { pubkey: policyPda, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
      ],
      data
    }),
    policyPda,
    vaultPda
  };
}

export function buildSetKillSwitchInstruction(input: {
  active: boolean;
  owner: PublicKey;
  programId?: PublicKey;
}): { instruction: TransactionInstruction; policyPda: PublicKey } {
  const programId = resolvePolicyGuardProgramId(input.programId);
  const [policyPda] = findPolicyPda(input.owner, programId);

  return {
    instruction: new TransactionInstruction({
      programId,
      keys: [
        { pubkey: input.owner, isSigner: true, isWritable: false },
        { pubkey: policyPda, isSigner: false, isWritable: true }
      ],
      data: Buffer.from([1, input.active ? 1 : 0])
    }),
    policyPda
  };
}

export function buildOpenSessionInstruction(input: SessionInstructionInput): {
  instruction: TransactionInstruction;
  policyPda: PublicKey;
  sessionPda: PublicKey;
} {
  const programId = resolvePolicyGuardProgramId(input.programId);
  const [policyPda] = findPolicyPda(input.owner, programId);
  const [sessionPda] = findSessionPda(policyPda, input.sessionId, programId);

  return {
    instruction: new TransactionInstruction({
      programId,
      keys: [
        { pubkey: input.owner, isSigner: true, isWritable: true },
        { pubkey: policyPda, isSigner: false, isWritable: false },
        { pubkey: sessionPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
      ],
      data: Buffer.concat([Buffer.from([2]), toFixedBuffer(input.sessionId, 32)])
    }),
    policyPda,
    sessionPda
  };
}

export function buildCloseSessionInstruction(input: SessionInstructionInput): {
  instruction: TransactionInstruction;
  policyPda: PublicKey;
  sessionPda: PublicKey;
} {
  const programId = resolvePolicyGuardProgramId(input.programId);
  const [policyPda] = findPolicyPda(input.owner, programId);
  const [sessionPda] = findSessionPda(policyPda, input.sessionId, programId);

  return {
    instruction: new TransactionInstruction({
      programId,
      keys: [
        { pubkey: input.owner, isSigner: true, isWritable: false },
        { pubkey: policyPda, isSigner: false, isWritable: false },
        { pubkey: sessionPda, isSigner: false, isWritable: true }
      ],
      data: Buffer.concat([Buffer.from([3]), toFixedBuffer(input.sessionId, 32)])
    }),
    policyPda,
    sessionPda
  };
}

export function buildManagedTransferInstructions(input: ManagedTransferInput): {
  ed25519Instruction: TransactionInstruction;
  payload: Buffer;
  policyPda: PublicKey;
  programInstruction: TransactionInstruction;
  sessionPda: PublicKey;
  vaultPda: PublicKey;
} {
  const programId = resolvePolicyGuardProgramId(input.programId);
  const signer = normalizeSigner(input.signer);
  const [policyPda] = findPolicyPda(input.policyOwner, programId);
  const [vaultPda] = findVaultPda(policyPda, programId);
  const [sessionPda] = findSessionPda(policyPda, input.sessionId, programId);
  const payload = encodeManagedTransferPayload({
    amountLamports: input.amountLamports,
    expiresAtUnix: input.expiresAtUnix,
    intentHash: Buffer.from(
      input.intentHash ?? deriveTransferIntentHash(input)
    ),
    nonce: input.nonce,
    recipient: input.recipient,
    sessionId: Buffer.from(input.sessionId),
    targetProgram: input.targetProgram ?? programId,
    timestampUnix: input.timestampUnix ?? Math.floor(Date.now() / 1000)
  });

  return {
    ed25519Instruction: Ed25519Program.createInstructionWithPrivateKey({
      privateKey: signer.secretKey,
      message: payload
    }),
    payload,
    policyPda,
    programInstruction: new TransactionInstruction({
      programId,
      keys: [
        { pubkey: policyPda, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: sessionPda, isSigner: false, isWritable: true },
        { pubkey: input.recipient, isSigner: false, isWritable: true },
        { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false }
      ],
      data: Buffer.concat([Buffer.from([EXECUTE_TRANSFER_OPCODE]), payload])
    }),
    sessionPda,
    vaultPda
  };
}

export function encodeManagedTransferPayload(input: ManagedTransferPayload): Buffer {
  const sessionId = toFixedBuffer(input.sessionId, 32);
  const intentHash = toFixedBuffer(input.intentHash, 32);
  const payload = Buffer.alloc(EXECUTE_TRANSFER_PAYLOAD_SIZE);
  let offset = 0;

  sessionId.copy(payload, offset);
  offset += 32;
  encodeU64(input.nonce).copy(payload, offset);
  offset += 8;
  encodeU64(input.amountLamports).copy(payload, offset);
  offset += 8;
  encodeI64(input.timestampUnix).copy(payload, offset);
  offset += 8;
  encodeI64(input.expiresAtUnix).copy(payload, offset);
  offset += 8;
  input.targetProgram.toBuffer().copy(payload, offset);
  offset += 32;
  input.recipient.toBuffer().copy(payload, offset);
  offset += 32;
  intentHash.copy(payload, offset);

  return payload;
}

export function deriveTransferIntentHash(input: {
  amountLamports: bigint;
  nonce: bigint;
  recipient: PublicKey;
  sessionId: Uint8Array;
  targetProgram?: PublicKey;
}): Buffer {
  const hash = createHash("sha256");
  hash.update(toFixedBuffer(input.sessionId, 32));
  hash.update(encodeU64(input.nonce));
  hash.update(encodeU64(input.amountLamports));
  hash.update(input.recipient.toBuffer());
  hash.update((input.targetProgram ?? DEFAULT_POLICY_GUARD_PROGRAM_ID).toBuffer());
  return hash.digest();
}

function normalizeSigner(input: Keypair | Uint8Array): Keypair {
  if (input instanceof Keypair) {
    return input;
  }

  if (input.length === 64) {
    return Keypair.fromSecretKey(input);
  }

  if (input.length === 32) {
    return Keypair.fromSeed(input);
  }

  throw new Error("Signer must be a Keypair, 32-byte seed, or 64-byte secret key.");
}

function toFixedBuffer(value: Uint8Array, expectedLength: number): Buffer {
  const buffer = Buffer.from(value);
  if (buffer.length !== expectedLength) {
    throw new Error(`Expected ${expectedLength} bytes but received ${buffer.length}.`);
  }
  return buffer;
}

function encodePubkeyArray(values: PublicKey[]): Buffer {
  return Buffer.concat([
    encodeU16(values.length),
    ...values.map((value) => value.toBuffer())
  ]);
}

function encodeU16(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value, 0);
  return out;
}

function encodeU32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value, 0);
  return out;
}

function encodeU64(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value, 0);
  return out;
}

function encodeI64(value: number): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigInt64LE(BigInt(value), 0);
  return out;
}
