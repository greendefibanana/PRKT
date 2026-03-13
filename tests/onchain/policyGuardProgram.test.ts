import { Keypair, PublicKey } from "@solana/web3.js";

import {
  buildInitializePolicyInstruction,
  buildManagedTransferInstructions,
  buildOpenSessionInstruction,
  createSessionId,
  findPolicyPda,
  findSessionPda,
  findVaultPda,
  getPolicyStateSpace,
  resolvePolicyGuardProgramId
} from "../../src/onchain";

describe("policy guard program helpers", () => {
  const owner = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
  const verifier = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 33));
  const recipient = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 65)).publicKey;

  it("derives stable policy, vault, and session PDAs", () => {
    const sessionId = createSessionId("demo-session");
    const programId = resolvePolicyGuardProgramId();
    const [policyPda] = findPolicyPda(owner.publicKey, programId);
    const [vaultPda] = findVaultPda(policyPda, programId);
    const [sessionPda] = findSessionPda(policyPda, sessionId, programId);

    expect(PublicKey.isOnCurve(policyPda.toBytes())).toBe(false);
    expect(PublicKey.isOnCurve(vaultPda.toBytes())).toBe(false);
    expect(PublicKey.isOnCurve(sessionPda.toBytes())).toBe(false);
  });

  it("computes policy state space for both allowlists", () => {
    expect(
      getPolicyStateSpace({
        allowedPrograms: [resolvePolicyGuardProgramId()],
        allowedRecipients: [recipient]
      })
    ).toBe(164);
  });

  it("builds initialize and open-session instructions", () => {
    const init = buildInitializePolicyInstruction({
      owner: owner.publicKey,
      verifier: verifier.publicKey,
      dailySpendLimitLamports: 50_000_000n,
      sessionTtlMinutes: 30,
      allowedPrograms: [resolvePolicyGuardProgramId()],
      allowedRecipients: [recipient]
    });
    const sessionId = createSessionId("policy-open");
    const session = buildOpenSessionInstruction({
      owner: owner.publicKey,
      sessionId
    });

    expect(init.instruction.data[0]).toBe(0);
    expect(init.instruction.keys[1]?.pubkey.toBase58()).toBe(init.policyPda.toBase58());
    expect(session.instruction.data[0]).toBe(2);
    expect(session.instruction.keys[2]?.pubkey.toBase58()).toBe(session.sessionPda.toBase58());
  });

  it("creates a signed managed-transfer instruction pair with matching payload bytes", () => {
    const sessionId = createSessionId("managed-transfer");
    const built = buildManagedTransferInstructions({
      amountLamports: 5_000_000n,
      nonce: 0n,
      policyOwner: owner.publicKey,
      recipient,
      sessionId,
      signer: verifier,
      expiresAtUnix: 1_900_000_000,
      timestampUnix: 1_800_000_000
    });

    expect(built.payload).toHaveLength(160);
    expect(built.programInstruction.data[0]).toBe(4);
    expect(Buffer.compare(built.programInstruction.data.subarray(1), built.payload)).toBe(0);

    const parsedEd25519 = parseEd25519Instruction(built.ed25519Instruction.data);
    expect(parsedEd25519.publicKey.toBase58()).toBe(verifier.publicKey.toBase58());
    expect(Buffer.compare(parsedEd25519.message, built.payload)).toBe(0);
  });
});

function parseEd25519Instruction(data: Buffer): { publicKey: PublicKey; message: Buffer } {
  const publicKeyOffset = data.readUInt16LE(6);
  const messageOffset = data.readUInt16LE(10);
  const messageSize = data.readUInt16LE(12);

  return {
    publicKey: new PublicKey(data.subarray(publicKeyOffset, publicKeyOffset + 32)),
    message: data.subarray(messageOffset, messageOffset + messageSize)
  };
}
