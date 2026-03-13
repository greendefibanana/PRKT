import { createHash } from "crypto";

import {
  createAccount,
  createBN254,
  createRpc,
  deriveAddress,
  deriveAddressSeed
} from "@lightprotocol/stateless.js";
import { Keypair, PublicKey } from "@solana/web3.js";

import { getZkCompressionApiUrl, getZkProverUrl } from "../config/env";
import { CompressionError } from "../errors/PRKTError";
import { buildExplorerTxUrl } from "../solana/memoLedger";
import { MEMO_PROGRAM_ID } from "../solana/programs";

const PRKT_COMMITMENT_NAMESPACE = Buffer.from("prkt", "utf8");

export type CompressedCommitmentRecord = {
  address: string;
  explorerUrl?: string;
  signature?: string;
  slot?: number;
};

export type CompressedCommitmentVerification = {
  address: string;
  exists: boolean;
  reason?: string;
};

function hashNamespaceParts(namespace: string, parts: string[]): Buffer {
  return createHash("sha256")
    .update(JSON.stringify([namespace, ...parts]), "utf8")
    .digest();
}

export function buildCommitmentParts(namespace: string, parts: string[]): Uint8Array[] {
  return [
    PRKT_COMMITMENT_NAMESPACE,
    Buffer.from(namespace, "utf8"),
    hashNamespaceParts(namespace, parts)
  ];
}

export class CompressedCommitmentAnchor {
  static isConfigured(): boolean {
    return getZkCompressionApiUrl() !== null;
  }

  private readonly rpc;

  // Until a dedicated PRKT compression owner program exists, use a stable
  // on-chain program ID to namespace these compressed commitments.
  private readonly ownerProgramId = MEMO_PROGRAM_ID;

  constructor(private readonly rpcEndpoint: string) {
    if (!CompressedCommitmentAnchor.isConfigured()) {
      throw new CompressionError(
        "Live zk compression requires ZK_COMPRESSION_API_URL to be configured."
      );
    }
    this.rpc = createRpc(
      this.rpcEndpoint,
      getZkCompressionApiUrl() ?? this.rpcEndpoint,
      getZkProverUrl() ?? getZkCompressionApiUrl() ?? this.rpcEndpoint
    );
  }

  deriveAddress(namespace: string, parts: string[]): PublicKey {
    const seed = deriveAddressSeed(
      buildCommitmentParts(namespace, parts),
      this.ownerProgramId
    );
    return deriveAddress(seed);
  }

  async anchorCommitment(input: {
    namespace: string;
    parts: string[];
    payer: Keypair;
  }): Promise<CompressedCommitmentRecord> {
    const address = this.deriveAddress(input.namespace, input.parts);
    const existing = await this.lookupByAddress(address);
    if (existing.exists) {
      return existing;
    }

    try {
      const signature = await createAccount(
        this.rpc,
        input.payer,
        buildCommitmentParts(input.namespace, input.parts),
        this.ownerProgramId
      );
      const confirmed = await this.rpc.getParsedTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0
      });
      return {
        address: address.toBase58(),
        explorerUrl: buildExplorerTxUrl(signature, this.rpcEndpoint),
        signature,
        slot: confirmed?.slot
      };
    } catch (error) {
      throw new CompressionError(`Failed to anchor compressed commitment: ${error}`);
    }
  }

  async verifyCommitment(input: {
    namespace: string;
    parts: string[];
  }): Promise<CompressedCommitmentVerification> {
    return this.lookupByAddress(this.deriveAddress(input.namespace, input.parts));
  }

  private async lookupByAddress(address: PublicKey): Promise<CompressedCommitmentVerification> {
    try {
      const account = await this.rpc.getCompressedAccount(
        createBN254(Buffer.from(address.toBytes()))
      );
      if (!account) {
        return {
          address: address.toBase58(),
          exists: false,
          reason: "COMPRESSED_ACCOUNT_NOT_FOUND"
        };
      }

      return {
        address: address.toBase58(),
        exists: true
      };
    } catch (error) {
      throw new CompressionError(`Failed to verify compressed commitment: ${error}`);
    }
  }
}
