import { Buffer } from "buffer";
import { createHash } from "crypto";

import { BN } from "@coral-xyz/anchor";
import {
  buildAndSignTx,
  createBN254,
  createCompressedAccountLegacy,
  createRpc,
  defaultStaticAccountsStruct,
  deriveAddress,
  deriveAddressSeed,
  encodeInstructionDataInvoke,
  getDefaultAddressTreeInfo,
  hashvToBn254FieldSizeBe,
  invokeAccountsLayout,
  LightSystemProgram,
  packCompressedAccounts,
  packNewAddressParams,
  selectStateTreeInfo,
  sendAndConfirmTx,
  toAccountMetas
} from "@lightprotocol/stateless.js";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction
} from "@solana/web3.js";

import { getZkCompressionApiUrl, getZkProverUrl, isDefensibleDevnetDemoMode } from "../config/env";
import { CompressionError } from "../errors/PRKTError";
import { buildExplorerTxUrl, sendMemoPayload } from "../solana/memoLedger";
import { MEMO_PROGRAM_ID } from "../solana/programs";
import {
  findLocalPayloadRecord,
  listLocalPayloadRecords,
  upsertLocalPayloadRecord
} from "./LocalPayloadRegistry";
import { buildCommitmentParts } from "./CompressedCommitmentAnchor";
import { CompressedCommitmentAnchor } from "./CompressedCommitmentAnchor";

export type CompressedDataWriteResult<T> = {
  address: string;
  explorerUrl?: string;
  payload: T;
  signature: string;
  slot?: number;
};

export type CompressedDataReadResult<T> = {
  address: string;
  exists: boolean;
  explorerUrl?: string;
  payload?: T;
  reason?: string;
  signature?: string;
  slot?: number;
};

type CompressionSignatureMetadata = {
  blockTime?: number;
  signature?: string;
  slot?: number;
};

export class CompressedDataAccount {
  static isConfigured(): boolean {
    return getZkCompressionApiUrl() !== null;
  }

  private readonly rpc;
  private readonly ownerProgramId = MEMO_PROGRAM_ID;
  private readonly useDefensibleDemoFallback = isDefensibleDevnetDemoMode();

  constructor(private readonly rpcEndpoint: string) {
    if (!CompressedDataAccount.isConfigured()) {
      throw new CompressionError(
        "Memo-free compressed storage requires ZK_COMPRESSION_API_URL to be configured."
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

  async writeAccount<T>(input: {
    discriminator: string | Uint8Array;
    namespace: string;
    parts: string[];
    payer: Keypair;
    payload: T;
  }): Promise<CompressedDataWriteResult<T>> {
    const localRecord = this.readLocalRecord<T>(input.discriminator, input.namespace, input.parts);
    if (localRecord) {
      return {
        address: localRecord.address,
        explorerUrl: localRecord.explorerUrl,
        payload: localRecord.payload,
        signature: localRecord.signature,
        slot: localRecord.slot
      };
    }

    const address = this.deriveAddress(input.namespace, input.parts);
    const existing = await this.readAccount<T>({
      discriminator: input.discriminator,
      namespace: input.namespace,
      parts: input.parts
    });
    if (existing.exists && existing.payload) {
      return {
        address: existing.address,
        explorerUrl: existing.explorerUrl,
        payload: existing.payload,
        signature: existing.signature ?? "",
        slot: existing.slot
      };
    }

    try {
      const seed = deriveAddressSeed(
        buildCommitmentParts(input.namespace, input.parts),
        this.ownerProgramId
      );
      const addressTreeInfo = getDefaultAddressTreeInfo();
      const outputStateTreeInfo = selectStateTreeInfo(await this.rpc.getStateTreeInfos());
      const proof = await this.rpc.getValidityProofV0(undefined, [
        {
          address: createBN254(Buffer.from(address.toBytes())),
          queue: addressTreeInfo.queue,
          tree: addressTreeInfo.tree
        }
      ]);

      const newAddressParams = {
        addressMerkleTreePubkey: proof.treeInfos[0].tree,
        addressMerkleTreeRootIndex: proof.rootIndices[0],
        addressQueuePubkey: proof.treeInfos[0].queue,
        seed
      };

      const outputAccount = createCompressedAccountLegacy(
        this.ownerProgramId,
        undefined,
        buildCompressedAccountData(input.discriminator, input.payload),
        Array.from(address.toBytes())
      );
      const packedAccounts = packCompressedAccounts([], [], [outputAccount], outputStateTreeInfo);
      const packedAddresses = packNewAddressParams([newAddressParams], packedAccounts.remainingAccounts);
      const instructionData = encodeInstructionDataInvoke({
        compressOrDecompressLamports: null,
        inputCompressedAccountsWithMerkleContext: packedAccounts.packedInputCompressedAccounts,
        isCompress: false,
        newAddressParams: packedAddresses.newAddressParamsPacked,
        outputCompressedAccounts: packedAccounts.packedOutputCompressedAccounts,
        proof: proof.compressedProof,
        relayFee: null
      });
      const keys = [
        ...invokeAccountsLayout({
          ...defaultStaticAccountsStruct(),
          authority: input.payer.publicKey,
          decompressionRecipient: null,
          feePayer: input.payer.publicKey,
          solPoolPda: null,
          systemProgram: SystemProgram.programId
        }),
        ...toAccountMetas(packedAddresses.remainingAccounts)
      ];
      const instruction = new TransactionInstruction({
        data: instructionData,
        keys,
        programId: LightSystemProgram.programId
      });
      const latestBlockhash = await this.rpc.getLatestBlockhash();
      const transaction = buildAndSignTx(
        [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }), instruction],
        input.payer,
        latestBlockhash.blockhash,
        []
      );
      const signature = await sendAndConfirmTx(this.rpc, transaction);
      const metadata = await this.lookupSignatureMetadata(address);

      return {
        address: address.toBase58(),
        explorerUrl: buildExplorerTxUrl(signature, this.rpcEndpoint),
        payload: input.payload,
        signature,
        slot: metadata.slot
      };
    } catch (error) {
      if (this.useDefensibleDemoFallback) {
        return this.writeFallbackRecord(input, address, error);
      }
      throw new CompressionError(`Failed to write compressed data account: ${error}`);
    }
  }

  async readAccount<T>(input: {
    discriminator: string | Uint8Array;
    namespace: string;
    parts: string[];
  }): Promise<CompressedDataReadResult<T>> {
    const localRecord = this.readLocalRecord<T>(input.discriminator, input.namespace, input.parts);
    if (localRecord) {
      return {
        address: localRecord.address,
        exists: true,
        explorerUrl: localRecord.explorerUrl,
        payload: localRecord.payload,
        signature: localRecord.signature,
        slot: localRecord.slot
      };
    }

    const address = this.deriveAddress(input.namespace, input.parts);

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

      const payload = decodeCompressedAccountPayload<T>(account, input.discriminator);
      if (!payload) {
        return {
          address: address.toBase58(),
          exists: false,
          reason: "COMPRESSED_ACCOUNT_PAYLOAD_INVALID"
        };
      }

      const metadata = await this.lookupSignatureMetadata(address);
      return {
        address: address.toBase58(),
        exists: true,
        explorerUrl: metadata.signature
          ? buildExplorerTxUrl(metadata.signature, this.rpcEndpoint)
          : undefined,
        payload,
        signature: metadata.signature,
        slot: metadata.slot
      };
    } catch (error) {
      throw new CompressionError(`Failed to read compressed data account: ${error}`);
    }
  }

  async findAccountsByOwner<T>(input: {
    discriminator: string | Uint8Array;
  }): Promise<Array<CompressedDataReadResult<T>>> {
    const localResults = this.listLocalRecords<T>(input.discriminator).map((record) => ({
      address: record.address,
      exists: true,
      explorerUrl: record.explorerUrl,
      payload: record.payload,
      signature: record.signature,
      slot: record.slot
    }));
    const results: Array<CompressedDataReadResult<T>> = [...localResults];
    let cursor: string | undefined;

    try {
      do {
        const page = await this.rpc.getCompressedAccountsByOwner(this.ownerProgramId, {
          cursor,
          limit: new BN(1_000)
        });

        for (const account of page.items) {
          const payload = decodeCompressedAccountPayload<T>(account, input.discriminator);
          if (!payload || !account.address) {
            continue;
          }

          const address = new PublicKey(Uint8Array.from(account.address));
          results.push({
            address: address.toBase58(),
            exists: true,
            payload
          });
        }

        cursor = page.cursor ?? undefined;
      } while (cursor);

      return results;
    } catch (error) {
      if (results.length > 0 && this.useDefensibleDemoFallback) {
        return results;
      }
      throw new CompressionError(`Failed to scan compressed owner records: ${error}`);
    }
  }

  private readLocalRecord<T>(
    discriminator: string | Uint8Array,
    namespace: string,
    parts: string[]
  ) {
    return findLocalPayloadRecord<T>({
      discriminatorHex: discriminatorToHex(discriminator),
      namespace,
      parts
    });
  }

  private listLocalRecords<T>(discriminator: string | Uint8Array) {
    return listLocalPayloadRecords<T>({
      discriminatorHex: discriminatorToHex(discriminator)
    });
  }

  private async writeFallbackRecord<T>(
    input: {
      discriminator: string | Uint8Array;
      namespace: string;
      parts: string[];
      payer: Keypair;
      payload: T;
    },
    address: PublicKey,
    originalError: unknown
  ): Promise<CompressedDataWriteResult<T>> {
    const discriminatorHex = discriminatorToHex(input.discriminator);
    const payloadHash = createHash("sha256")
      .update(JSON.stringify(input.payload), "utf8")
      .digest("hex");

    try {
      const anchor = new CompressedCommitmentAnchor(this.rpcEndpoint);
      const anchored = await anchor.anchorCommitment({
        namespace: input.namespace,
        parts: input.parts,
        payer: input.payer
      });
      upsertLocalPayloadRecord({
        address: address.toBase58(),
        anchorMode: "light-commitment",
        discriminatorHex,
        explorerUrl: anchored.explorerUrl,
        namespace: input.namespace,
        parts: input.parts,
        payload: input.payload,
        signature: anchored.signature ?? "",
        slot: anchored.slot,
        storedAt: Date.now()
      });
      return {
        address: address.toBase58(),
        explorerUrl: anchored.explorerUrl,
        payload: input.payload,
        signature: anchored.signature ?? "",
        slot: anchored.slot
      };
    } catch {
      const memo = await sendMemoPayload({
        connection: this.rpc,
        payload: {
          address: address.toBase58(),
          d: discriminatorHex,
          e: "PRKT_COMPRESSED_FALLBACK",
          h: payloadHash,
          n: input.namespace,
          p: input.parts,
          prkt: 1
        },
        payer: input.payer
      });
      const explorerUrl = buildExplorerTxUrl(memo.signature, this.rpcEndpoint);
      upsertLocalPayloadRecord({
        address: address.toBase58(),
        anchorMode: "memo",
        discriminatorHex,
        explorerUrl,
        namespace: input.namespace,
        parts: input.parts,
        payload: input.payload,
        signature: memo.signature,
        slot: memo.slot,
        storedAt: Date.now()
      });
      return {
        address: address.toBase58(),
        explorerUrl,
        payload: input.payload,
        signature: memo.signature,
        slot: memo.slot
      };
    }
  }

  private async lookupSignatureMetadata(address: PublicKey): Promise<CompressionSignatureMetadata> {
    try {
      const signatures = await this.rpc.getCompressionSignaturesForAddress(address, {
        limit: new BN(1)
      });
      const latest = signatures.items[0];
      if (!latest) {
        return {};
      }

      return {
        blockTime: latest.blockTime,
        signature: latest.signature,
        slot: latest.slot
      };
    } catch {
      return {};
    }
  }
}

function buildCompressedAccountData(
  discriminator: string | Uint8Array,
  payload: unknown
): { data: Buffer; dataHash: number[]; discriminator: number[] } {
  const discriminatorBytes = normalizeDiscriminator(discriminator);
  const data = Buffer.from(JSON.stringify(payload), "utf8");
  const dataHash = hashvToBn254FieldSizeBe([Buffer.from(discriminatorBytes), data]);

  return {
    data,
    dataHash: Array.from(dataHash),
    discriminator: Array.from(discriminatorBytes)
  };
}

function decodeCompressedAccountPayload<T>(
  account: {
    data: {
      data: Buffer | Uint8Array;
      discriminator: number[];
    } | null;
  },
  discriminator: string | Uint8Array
): T | null {
  if (!account.data) {
    return null;
  }

  const expected = Array.from(normalizeDiscriminator(discriminator));
  if (
    account.data.discriminator.length !== expected.length ||
    account.data.discriminator.some((value, index) => value !== expected[index])
  ) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(account.data.data).toString("utf8")) as T;
  } catch {
    return null;
  }
}

function normalizeDiscriminator(discriminator: string | Uint8Array): Uint8Array {
  const bytes =
    typeof discriminator === "string"
      ? Buffer.from(discriminator, "utf8")
      : Uint8Array.from(discriminator);
  if (bytes.length !== 8) {
    throw new CompressionError(
      `Compressed account discriminator must be exactly 8 bytes, received ${bytes.length}.`
    );
  }

  return bytes;
}

function discriminatorToHex(discriminator: string | Uint8Array): string {
  return Buffer.from(normalizeDiscriminator(discriminator)).toString("hex");
}
