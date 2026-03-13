import { createHash } from "crypto";

import { BN } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  MessageV0,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  VersionedTransaction
} from "@solana/web3.js";
import nacl from "tweetnacl";

import { getOptionalDevnetTreasurySecretKey } from "../../src/config/env";
import { WalletManager } from "../../src/core/wallet/WalletManager";
import {
  PolicyCircuit,
  PolicyViolation
} from "../../src/zk/PolicyCircuit";
import { ProofAnchor } from "../../src/zk/ProofAnchor";

const describeDevnet = process.env.PRKT_RUN_DEVNET_TESTS === "1" ? describe : describe.skip;

describe("PolicyCircuit", () => {
  it("generates a signed policy attestation for a valid intent", async () => {
    const signer = Keypair.generate();
    const transaction = createTransaction(signer);
    const state = createPolicyState();

    const { approved, proof } = await PolicyCircuit.prove(
      transaction,
      state,
      "EXECUTE",
      100_000_000n,
      signer
    );

    const attestationHash = createHash("sha256")
      .update(JSON.stringify(proof.attestation), "utf8")
      .digest();

    expect(approved).toBe(true);
    expect(Array.from(proof.signature)).not.toEqual([1, 2, 3, 4]);
    expect(proof.publicKey).toBe(signer.publicKey.toBase58());
    expect(
      nacl.sign.detached.verify(
        attestationHash,
        proof.signature,
        signer.publicKey.toBytes()
      )
    ).toBe(true);
  });

  it("throws PolicyViolation when the requested spend exceeds the daily limit", async () => {
    const signer = Keypair.generate();
    const transaction = createTransaction(signer);
    const state = createPolicyState({
      dailySpendLimit: new BN(2_000_000_000),
      spentToday: new BN(1_900_000_000)
    });

    await expect(
      PolicyCircuit.prove(transaction, state, "EXECUTE", 200_000_001n, signer)
    ).rejects.toThrow(PolicyViolation);
  });
});

describeDevnet("ProofAnchor devnet", () => {
  jest.setTimeout(120_000);

  it("anchors and verifies a real policy attestation on Solana devnet", async () => {
    const rpcEndpoint = "https://api.devnet.solana.com";
    const connection = new Connection(rpcEndpoint, "confirmed");
    const signer = Keypair.generate();
    const wallet = WalletManager.fromSecretKey(signer.secretKey, "generated");
    const anchor = new ProofAnchor(rpcEndpoint, wallet);

    await fundWallet(connection, signer.publicKey);

    const txSignature = `devnet-proof-${Date.now()}`;
    const transaction = createTransaction(signer);
    const { proof } = await PolicyCircuit.prove(
      transaction,
      createPolicyState(),
      "EXECUTE",
      100_000_000n,
      signer
    );

    const anchored = await anchor.anchorProof(proof, txSignature, signer);
    expect(anchored.slot).toBeGreaterThan(0);
    expect(anchored.anchorSignature).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(anchored.explorerUrl).toContain(anchored.anchorSignature);

    const verification = await anchor.verifyProof(txSignature);
    expect(verification.valid).toBe(true);
    expect(verification.slot).toBeGreaterThan(0);
    expect(verification.attestation?.intentHash).toBe(proof.attestation.intentHash);
    expect(verification.checks?.spendLimit.passed).toBe(true);

    const explorerResponse = await fetch(anchored.explorerUrl, {
      redirect: "follow"
    });
    expect(explorerResponse.status).toBe(200);
  });
});

function createPolicyState(overrides?: Partial<Parameters<typeof PolicyCircuit.prove>[1]>) {
  return {
    agentId: "agent-proof",
    dailySpendLimit: new BN(2_000_000_000),
    killSwitchActive: false,
    lastResetTimestamp: Date.now() - 60_000,
    programAllowlist: [],
    sessionTTL: 60,
    spentToday: new BN(500_000_000),
    ...overrides
  };
}

function createTransaction(signer: Keypair): VersionedTransaction {
  const transaction = new VersionedTransaction(MessageV0.compile({
    instructions: [],
    payerKey: signer.publicKey,
    recentBlockhash: "11111111111111111111111111111111"
  }));
  transaction.sign([signer]);
  return transaction;
}

async function fundWallet(connection: Connection, publicKey: PublicKey): Promise<void> {
  const treasurySecretKey = getOptionalDevnetTreasurySecretKey();
  if (treasurySecretKey) {
    const treasury = Keypair.fromSecretKey(treasurySecretKey);
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: treasury.publicKey,
        lamports: LAMPORTS_PER_SOL / 10,
        toPubkey: publicKey
      })
    );
    await sendAndConfirmTransaction(connection, transaction, [treasury], {
      commitment: "confirmed"
    });
    return;
  }

  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const signature = await connection.requestAirdrop(publicKey, LAMPORTS_PER_SOL / 10);
      await connection.confirmTransaction(signature, "confirmed");
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("devnet airdrop failed");
}
