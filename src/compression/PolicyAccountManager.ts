import { BN } from "@coral-xyz/anchor";
import {
    Keypair,
    PublicKey,
} from "@solana/web3.js";

import { CompressionError } from "../errors/PRKTError";
import { CompressedPolicyState } from "./types";
import { CompressedDataAccount } from "../zkCompression/CompressedDataAccount";

const POLICY_ACCOUNT_DISCRIMINATOR = "PRKTPOL1";

type PolicyCompressedPayload = {
    a: string;
    d: string;
    k: 0 | 1;
    l: string[];
    r: number;
    s: number;
    t: string;
    u: number;
};

export class PolicyAccountManager {
    private static readonly policyRegistry = new Map<string, CompressedPolicyState>();

    constructor(private readonly rpcEndpoint: string) {}

    async createCompressedPolicyAccount(
        agentId: string,
        policy: Omit<CompressedPolicyState, "agentId">,
        payer: Keypair
    ): Promise<string> {
        try {
            const state: CompressedPolicyState = {
                agentId,
                ...policy
            };
            const updatedAt = Date.now();
            const record = await this.getStore().writeAccount({
                discriminator: POLICY_ACCOUNT_DISCRIMINATOR,
                namespace: "prkt-policy",
                parts: [agentId, updatedAt.toString()],
                payer,
                payload: serializePolicy(state, updatedAt)
            });
            PolicyAccountManager.policyRegistry.set(agentId, state);
            return record.signature;
        } catch (error) {
            throw new CompressionError(`Failed to create compressed policy account: ${error}`);
        }
    }

    async fetchCompressedPolicyAccount(agentId: string): Promise<CompressedPolicyState> {
        try {
            const inMemory = PolicyAccountManager.policyRegistry.get(agentId);
            if (inMemory) {
                return inMemory;
            }

            const records = await this.getStore().findAccountsByOwner<PolicyCompressedPayload>({
                discriminator: POLICY_ACCOUNT_DISCRIMINATOR
            });
            const payload = records
                .map((record) => record.payload)
                .filter((value): value is PolicyCompressedPayload => !!value && value.a === agentId)
                .sort((left, right) => right.u - left.u)[0];
            if (payload) {
                const policy = deserializePolicy(payload);
                PolicyAccountManager.policyRegistry.set(agentId, policy);
                return policy;
            }

            throw new Error(`policy not found for ${agentId}`);
        } catch (error) {
            throw new CompressionError(`Failed to fetch compressed policy account: ${error}`);
        }
    }

    async updateCompressedPolicyAccount(
        agentId: string,
        updates: Partial<CompressedPolicyState>,
        payer: Keypair
    ): Promise<string> {
        try {
            const current = await this.fetchCompressedPolicyAccount(agentId);
            const merged: CompressedPolicyState = {
                ...current,
                ...updates,
                agentId,
                dailySpendLimit: updates.dailySpendLimit ?? current.dailySpendLimit,
                programAllowlist: updates.programAllowlist ?? current.programAllowlist,
                spentToday: updates.spentToday ?? current.spentToday
            };
            const updatedAt = Date.now();
            const record = await this.getStore().writeAccount({
                discriminator: POLICY_ACCOUNT_DISCRIMINATOR,
                namespace: "prkt-policy",
                parts: [agentId, updatedAt.toString()],
                payer,
                payload: serializePolicy(merged, updatedAt)
            });
            PolicyAccountManager.policyRegistry.set(agentId, merged);
            return record.signature;
        } catch (error) {
            throw new CompressionError(`Failed to update compressed policy account: ${error}`);
        }
    }

    private getStore(): CompressedDataAccount {
        return new CompressedDataAccount(this.rpcEndpoint);
    }
}

function serializePolicy(policy: CompressedPolicyState, updatedAt: number): PolicyCompressedPayload {
    return {
        a: policy.agentId,
        d: policy.dailySpendLimit.toString(),
        k: policy.killSwitchActive ? 1 : 0,
        l: policy.programAllowlist.map((programId) => programId.toBase58()),
        r: policy.lastResetTimestamp,
        s: policy.sessionTTL,
        t: policy.spentToday.toString(),
        u: updatedAt
    };
}

function deserializePolicy(payload: PolicyCompressedPayload): CompressedPolicyState {
    return {
        agentId: payload.a,
        dailySpendLimit: new BN(payload.d),
        killSwitchActive: payload.k === 1,
        lastResetTimestamp: payload.r,
        programAllowlist: payload.l.map((programId) => new PublicKey(programId)),
        sessionTTL: payload.s,
        spentToday: new BN(payload.t)
    };
}
