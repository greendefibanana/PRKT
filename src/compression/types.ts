import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

export interface CompressedPolicyState {
    agentId: string;
    dailySpendLimit: BN;
    sessionTTL: number;
    programAllowlist: PublicKey[];
    killSwitchActive: boolean;
    spentToday: BN;
    lastResetTimestamp: number;
}

export interface AuditEntry {
    agentId: string;
    timestamp: number;
    intentType: string;
    approved: boolean;
    rejectionReason?: string;
    simulationResult: string;
    txSignature?: string;
}
