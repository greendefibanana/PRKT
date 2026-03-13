import { createHash } from "crypto";

import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";

const readAccountMock = jest.fn();
const writeAccountMock = jest.fn();
const compressedDataAccountConstructorMock = jest.fn();

jest.mock("../../src/zkCompression/CompressedDataAccount", () => ({
  CompressedDataAccount: function (...args: unknown[]) {
    compressedDataAccountConstructorMock(...args);
    return {
      readAccount: (...innerArgs: unknown[]) => readAccountMock(...innerArgs),
      writeAccount: (...innerArgs: unknown[]) => writeAccountMock(...innerArgs)
    };
  }
}));

import { ProofAnchor } from "../../src/zk/ProofAnchor";
import { PolicyAttestation, PolicyProof } from "../../src/zk/PolicyCircuit";

describe("ProofAnchor", () => {
  const payer = Keypair.generate();
  const walletManager = { payer };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("anchors proofs into compressed storage", async () => {
    writeAccountMock.mockResolvedValue({
      address: "proof-address",
      explorerUrl: "https://explorer/tx/proof-sig",
      payload: {},
      signature: "proof-sig",
      slot: 55
    });

    const proof = buildProof();
    const anchor = new ProofAnchor("https://api.devnet.solana.com", walletManager as never);
    const result = await anchor.anchorProof(proof, "tx-1", payer);

    expect(writeAccountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        discriminator: "PRKTPRF1",
        namespace: "prkt-proof",
        parts: ["tx-1"],
        payer
      })
    );
    expect(result.anchorSignature).toBe("proof-sig");
    expect(result.compressedAnchorAddress).toBe("proof-address");
    expect(result.slot).toBe(55);
  });

  it("verifies proofs from compressed storage", async () => {
    const proof = buildProof();
    readAccountMock.mockResolvedValue({
      address: "proof-address",
      exists: true,
      explorerUrl: "https://explorer/tx/proof-sig",
      payload: {
        attestation: proof.attestation,
        publicKey: proof.publicKey,
        signature: Buffer.from(proof.signature).toString("base64"),
        txSignature: "tx-1"
      },
      signature: "proof-sig",
      slot: 56
    });

    const anchor = new ProofAnchor("https://api.devnet.solana.com", walletManager as never);
    const result = await anchor.verifyProof("tx-1");

    expect(readAccountMock).toHaveBeenCalledWith({
      discriminator: "PRKTPRF1",
      namespace: "prkt-proof",
      parts: ["tx-1"]
    });
    expect(result.valid).toBe(true);
    expect(result.anchorSignature).toBe("proof-sig");
    expect(result.publicKey).toBe(proof.publicKey);
  });
});

function buildProof(): PolicyProof {
  const signer = Keypair.generate();
  const attestation: PolicyAttestation = {
    agentId: "agent-1",
    checks: {
      allowlist: {
        passed: true,
        program: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
      },
      killSwitch: {
        active: false,
        passed: true
      },
      spendLimit: {
        limitLamports: "1000",
        passed: true,
        requestedLamports: "10",
        spentLamports: "5"
      },
      ttl: {
        expiresAt: 200,
        now: 100,
        passed: true
      }
    },
    intentHash: "intent-1",
    policyHash: "policy-1",
    prover: "PRKT-LOCAL-v1",
    timestamp: 123
  };
  const digest = createHash("sha256")
    .update(JSON.stringify(attestation), "utf8")
    .digest();

  return {
    attestation,
    publicKey: signer.publicKey.toBase58(),
    signature: nacl.sign.detached(digest, signer.secretKey)
  };
}
