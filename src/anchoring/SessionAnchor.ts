import { createHash, randomUUID } from "crypto";

import { AuditEntry } from "../compression/types";
import { AnchorError } from "../errors/PRKTError";
import { WalletManager } from "../core/wallet/WalletManager";
import {
    buildExplorerTxUrl,
} from "../solana/memoLedger";
import { CompressedDataAccount } from "../zkCompression/CompressedDataAccount";

const SESSION_START_DISCRIMINATOR = "PRKTSS01";
const SESSION_CLOSE_DISCRIMINATOR = "PRKTSC01";

type SessionMemoPayload =
    | {
        prkt: 1;
        event: "SESSION_START";
        agentId: string;
        sessionId: string;
        ts: number;
    }
    | {
        prkt: 1;
        event: "SESSION_CLOSE";
        entryCount: number;
        logHash: string;
        sessionId: string;
        ts: number;
    };

type SessionRegistryRecord = {
    closeCompressedAddress?: string;
    closeSignature?: string;
    commitment?: string;
    entryCount?: number;
    startCompressedAddress?: string;
    startSignature?: string;
};

export type SessionStartResult = {
    compressedAnchorAddress?: string;
    compressedAnchorSignature?: string;
    sessionId: string;
    slot: number;
    startSignature: string;
};

export type SessionCloseResult = {
    closeSignature: string;
    compressedAnchorAddress?: string;
    compressedAnchorSignature?: string;
    commitment: string;
    entryCount: number;
    explorerUrl: string;
    ledgerSlot: number;
    sessionId: string;
    slot: number;
};

export type SessionVerifyResult = {
    closeSignature?: string;
    commitment?: string;
    entries: AuditEntry[];
    entryCount: number;
    explorerUrl?: string;
    reason?: string;
    slot?: number;
    valid: boolean;
};

export class SessionAnchor {
    private static readonly sessionRegistry = new Map<string, SessionRegistryRecord>();
    constructor(
        private readonly rpcEndpoint: string,
        private readonly walletManager?: WalletManager
    ) {}

    async startSession(agentId: string): Promise<SessionStartResult> {
        try {
            const sessionId = randomUUID();
            const payload: SessionMemoPayload = {
                agentId,
                event: "SESSION_START",
                prkt: 1,
                sessionId,
                ts: Date.now()
            };
            const anchored = await this.getStore().writeAccount({
                discriminator: SESSION_START_DISCRIMINATOR,
                namespace: "prkt-session-start",
                parts: [sessionId],
                payer: this.getPayer(),
                payload
            });
            SessionAnchor.sessionRegistry.set(sessionId, {
                startCompressedAddress: anchored.address,
                startSignature: anchored.signature
            });
            return {
                compressedAnchorAddress: anchored.address,
                compressedAnchorSignature: anchored.signature,
                sessionId,
                slot: anchored.slot ?? 0,
                startSignature: anchored.signature
            };
        } catch (error) {
            throw new AnchorError(`Failed to start session: ${error}`);
        }
    }

    async closeSession(sessionId: string, auditLog: AuditEntry[]): Promise<SessionCloseResult> {
        try {
            const serialized = JSON.stringify(auditLog);
            const hash = createHash("sha256").update(serialized).digest("hex");
            const payload: SessionMemoPayload = {
                entryCount: auditLog.length,
                event: "SESSION_CLOSE",
                logHash: hash,
                prkt: 1,
                sessionId,
                ts: Date.now()
            };
            const anchored = await this.getStore().writeAccount({
                discriminator: SESSION_CLOSE_DISCRIMINATOR,
                namespace: "prkt-session-close",
                parts: [sessionId],
                payer: this.getPayer(),
                payload
            });
            SessionAnchor.sessionRegistry.set(sessionId, {
                ...SessionAnchor.sessionRegistry.get(sessionId),
                closeCompressedAddress: anchored.address,
                closeSignature: anchored.signature,
                commitment: hash,
                entryCount: auditLog.length
            });

            return {
                closeSignature: anchored.signature,
                compressedAnchorAddress: anchored.address,
                compressedAnchorSignature: anchored.signature,
                commitment: hash,
                entryCount: auditLog.length,
                explorerUrl: this.buildExplorerUrl(anchored.signature),
                ledgerSlot: anchored.slot ?? 0,
                sessionId,
                slot: anchored.slot ?? 0
            };
        } catch (error) {
            throw new AnchorError(`Failed to close session: ${error}`);
        }
    }

    async verifySession(sessionId: string, commitment?: string): Promise<SessionVerifyResult> {
        try {
            const record = await this.getStore().readAccount<SessionMemoPayload>({
                discriminator: SESSION_CLOSE_DISCRIMINATOR,
                namespace: "prkt-session-close",
                parts: [sessionId]
            });
            if (!record.exists || !record.payload) {
                return {
                    entries: [],
                    entryCount: 0,
                    reason: record.reason ?? "SESSION_NOT_FOUND",
                    valid: false
                };
            }

            const payload = record.payload;
            if (payload.event !== "SESSION_CLOSE" || payload.sessionId !== sessionId) {
                return {
                    closeSignature: record.signature,
                    entries: [],
                    entryCount: 0,
                    reason: "SESSION_RECORD_INVALID",
                    valid: false
                };
            }

            if (commitment && payload.logHash !== commitment) {
                return {
                    closeSignature: record.signature,
                    commitment: payload.logHash,
                    entries: [],
                    entryCount: payload.entryCount,
                    explorerUrl: record.explorerUrl,
                    reason: "HASH_MISMATCH",
                    slot: record.slot,
                    valid: false
                };
            }

            return {
                closeSignature: record.signature,
                commitment: payload.logHash,
                entries: [],
                entryCount: payload.entryCount,
                explorerUrl: record.explorerUrl,
                slot: record.slot,
                valid: true
            };
        } catch (error) {
            throw new AnchorError(`Failed to verify session: ${error}`);
        }
    }

    private buildExplorerUrl(signature: string): string {
        return buildExplorerTxUrl(signature, this.rpcEndpoint);
    }

    private getPayer() {
        const wallet = this.walletManager ?? WalletManager.loadOrGenerate();
        try {
            return wallet.payer;
        } catch (error) {
            throw new AnchorError(`Compressed session storage requires a local signer: ${error}`);
        }
    }

    private getStore(): CompressedDataAccount {
        return new CompressedDataAccount(this.rpcEndpoint);
    }
}
