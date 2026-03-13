import { createHash } from "crypto";

import { AuditEntry } from "./types";
import { CompressionError } from "../errors/PRKTError";
import { CompressedDataAccount } from "../zkCompression/CompressedDataAccount";

const AUDIT_ACCOUNT_DISCRIMINATOR = "PRKTAUD1";

type AuditCompressedPayload = {
    a: string;
    i: string;
    ok: 0 | 1;
    r?: string;
    s: string;
    t: number;
    tx?: string;
};

export class AuditLogManager {
    private static readonly auditRegistry = new Map<string, AuditEntry[]>();

    constructor(private readonly rpcEndpoint: string) {}

    async appendAuditEntry(
        entry: AuditEntry,
        payer: import("@solana/web3.js").Keypair
    ): Promise<string> {
        try {
            const payload = serializeAuditEntry(entry);
            const signature = await this.getStore().writeAccount({
                discriminator: AUDIT_ACCOUNT_DISCRIMINATOR,
                namespace: "prkt-audit",
                parts: [entry.agentId, entry.timestamp.toString(), hashAuditEntry(entry)],
                payer,
                payload
            });
            const existing = AuditLogManager.auditRegistry.get(entry.agentId) ?? [];
            existing.push(entry);
            existing.sort((left, right) => left.timestamp - right.timestamp);
            AuditLogManager.auditRegistry.set(entry.agentId, existing);
            return signature.signature;
        } catch (error) {
            throw new CompressionError(`Failed to append audit entry: ${error}`);
        }
    }

    async fetchAuditLog(agentId: string, limit?: number): Promise<AuditEntry[]> {
        try {
            const inMemory = AuditLogManager.auditRegistry.get(agentId);
            if (inMemory && inMemory.length > 0) {
                return [...inMemory].slice(-(limit ?? inMemory.length));
            }

            const records = await this.getStore().findAccountsByOwner<AuditCompressedPayload>({
                discriminator: AUDIT_ACCOUNT_DISCRIMINATOR
            });
            const entries = records
                .map((record) => record.payload)
                .filter((payload): payload is AuditCompressedPayload => !!payload && payload.a === agentId)
                .map(deserializeAuditEntry)
                .sort((left, right) => left.timestamp - right.timestamp);

            AuditLogManager.auditRegistry.set(agentId, entries);
            return limit ? entries.slice(-limit) : entries;
        } catch (error) {
            throw new CompressionError(`Failed to fetch audit log: ${error}`);
        }
    }

    private getStore(): CompressedDataAccount {
        return new CompressedDataAccount(this.rpcEndpoint);
    }
}

function serializeAuditEntry(entry: AuditEntry): AuditCompressedPayload {
    return {
        a: entry.agentId,
        i: entry.intentType,
        ok: entry.approved ? 1 : 0,
        r: entry.rejectionReason,
        s: entry.simulationResult,
        t: entry.timestamp,
        tx: entry.txSignature
    };
}

function deserializeAuditEntry(payload: AuditCompressedPayload): AuditEntry {
    return {
        agentId: payload.a,
        approved: payload.ok === 1,
        intentType: payload.i,
        rejectionReason: payload.r,
        simulationResult: payload.s,
        timestamp: payload.t,
        txSignature: payload.tx
    };
}

function hashAuditEntry(entry: AuditEntry): string {
    return createHash("sha256")
        .update(JSON.stringify(serializeAuditEntry(entry)), "utf8")
        .digest("hex");
}
