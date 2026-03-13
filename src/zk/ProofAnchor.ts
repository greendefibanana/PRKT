import { createHash } from "crypto";

import {
    Keypair,
    PublicKey,
} from "@solana/web3.js";
import nacl from "tweetnacl";

import { WalletManager } from "../core/wallet/WalletManager";
import { AnchorError, ProofError } from "../errors/PRKTError";
import {
    buildExplorerTxUrl,
} from "../solana/memoLedger";
import { PolicyAttestation, PolicyProof } from "./PolicyCircuit";
import { CompressedDataAccount } from "../zkCompression/CompressedDataAccount";

const PROOF_ACCOUNT_DISCRIMINATOR = "PRKTPRF1";

type ProofCompressedPayload = {
    attestation: PolicyAttestation;
    publicKey: string;
    signature: string;
    txSignature: string;
};

type ProofAnchorResult = {
    anchorSignature: string;
    compressedAnchorAddress?: string;
    compressedAnchorSignature?: string;
    explorerUrl: string;
    slot: number;
};

type ProofVerifyResult = {
    anchorSignature?: string;
    attestation?: PolicyAttestation;
    checks?: PolicyAttestation["checks"];
    explorerUrl?: string;
    publicKey?: string;
    reason?: string;
    slot?: number;
    txSignature?: string;
    valid: boolean;
};

export class ProofAnchor {
    private static readonly proofRegistry = new Map<string, string>();
    constructor(
        private readonly rpcEndpoint: string,
        private readonly walletManager?: WalletManager
    ) {}

    async anchorProof(proof: PolicyProof, txSignature: string, signer?: Keypair): Promise<ProofAnchorResult> {
        try {
            const anchored = await this.getStore().writeAccount({
                discriminator: PROOF_ACCOUNT_DISCRIMINATOR,
                namespace: "prkt-proof",
                parts: [txSignature],
                payer: this.getPayer(signer),
                payload: {
                    attestation: proof.attestation,
                    publicKey: proof.publicKey,
                    signature: Buffer.from(proof.signature).toString("base64"),
                    txSignature
                } satisfies ProofCompressedPayload
            });
            ProofAnchor.proofRegistry.set(txSignature, anchored.signature);
            return {
                anchorSignature: anchored.signature,
                compressedAnchorAddress: anchored.address,
                compressedAnchorSignature: anchored.signature,
                explorerUrl: anchored.explorerUrl ?? this.buildExplorerUrl(anchored.signature),
                slot: anchored.slot ?? 0
            };
        } catch (error) {
            throw new ProofError(`Failed to anchor proof: ${error}`);
        }
    }

    async verifyProof(txSignature: string): Promise<ProofVerifyResult> {
        try {
            const record = await this.getStore().readAccount<ProofCompressedPayload>({
                discriminator: PROOF_ACCOUNT_DISCRIMINATOR,
                namespace: "prkt-proof",
                parts: [txSignature]
            });
            if (!record.exists || !record.payload) {
                return {
                    reason: record.reason ?? "PROOF_NOT_FOUND",
                    txSignature,
                    valid: false
                };
            }

            if (record.payload.txSignature !== txSignature) {
                return {
                    anchorSignature: record.signature,
                    reason: "ANCHOR_RECORD_INVALID",
                    txSignature,
                    valid: false
                };
            }

            const attestation = record.payload.attestation;

            const attestationHash = createHash("sha256")
                .update(JSON.stringify(attestation), "utf8")
                .digest();
            const valid = nacl.sign.detached.verify(
                attestationHash,
                Buffer.from(record.payload.signature, "base64"),
                new PublicKey(record.payload.publicKey).toBytes()
            );

            return {
                anchorSignature: record.signature,
                attestation,
                checks: attestation.checks,
                explorerUrl: record.explorerUrl,
                publicKey: record.payload.publicKey,
                reason: valid ? undefined : "SIGNATURE_VERIFICATION_FAILED",
                slot: record.slot,
                txSignature,
                valid
            };
        } catch (error) {
            throw new ProofError(`Failed to verify proof: ${error}`);
        }
    }

    private buildExplorerUrl(signature: string): string {
        return buildExplorerTxUrl(signature, this.rpcEndpoint);
    }

    private getPayer(signer?: Keypair): Keypair {
        const wallet = this.walletManager ?? WalletManager.loadOrGenerate();
        try {
            return signer ?? wallet.payer;
        } catch (error) {
            throw new AnchorError(`Compressed proof storage requires a local signer: ${error}`);
        }
    }

    private getStore(): CompressedDataAccount {
        return new CompressedDataAccount(this.rpcEndpoint);
    }
}
