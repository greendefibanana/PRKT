import { createHash } from "crypto";

import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import nacl from "tweetnacl";

import { CompressedPolicyState } from "../compression/types";
import { ProofError } from "../errors/PRKTError";

type PolicyCheckSummary = {
    passed: boolean;
};

export type PolicyAttestation = {
    agentId: string;
    checks: {
        allowlist: PolicyCheckSummary & {
            program: string;
        };
        killSwitch: PolicyCheckSummary & {
            active: boolean;
        };
        spendLimit: PolicyCheckSummary & {
            limitLamports: string;
            requestedLamports: string;
            spentLamports: string;
        };
        ttl: PolicyCheckSummary & {
            expiresAt: number;
            now: number;
        };
    };
    intentHash: string;
    policyHash: string;
    prover: "PRKT-LOCAL-v1";
    timestamp: number;
};

export type PolicyProof = {
    attestation: PolicyAttestation;
    publicKey: string;
    signature: Uint8Array;
};

export class PolicyViolation extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PolicyViolation";
    }
}

type SerializableIntent = VersionedTransaction | Record<string, unknown> | {
    serialize?: () => Uint8Array;
};

export class PolicyCircuit {
    static async prove(
        intent: SerializableIntent,
        policyState: CompressedPolicyState,
        intentType: string,
        requestedAmount: bigint,
        agentKeypair?: Keypair
    ): Promise<{ approved: true; proof: PolicyProof; reason: string }> {
        try {
            const signer = agentKeypair ?? Keypair.generate();
            const now = Date.now();
            const requestedAmountBn = new BN(requestedAmount.toString());
            const expiresAt = policyState.lastResetTimestamp + policyState.sessionTTL * 60_000;

            if (policyState.killSwitchActive) {
                throw new PolicyViolation("KILL_SWITCH_ACTIVE");
            }

            if (now > expiresAt) {
                throw new PolicyViolation("SESSION_TTL_EXPIRED");
            }

            if (policyState.spentToday.add(requestedAmountBn).gt(policyState.dailySpendLimit)) {
                throw new PolicyViolation("DAILY_LIMIT_EXCEEDED");
            }

            const programsSeen = extractProgramsSeen(intent);
            if (policyState.programAllowlist.length > 0 && programsSeen.length > 0) {
                const allowlist = new Set(policyState.programAllowlist.map((programId) => programId.toBase58()));
                const blockedProgram = programsSeen.find((programId) => !allowlist.has(programId));
                if (blockedProgram) {
                    throw new PolicyViolation(`PROGRAM_NOT_ALLOWED:${blockedProgram}`);
                }
            }

            const attestation: PolicyAttestation = {
                agentId: policyState.agentId,
                checks: {
                    allowlist: {
                        passed: true,
                        program: programsSeen[0] ?? "NONE"
                    },
                    killSwitch: {
                        active: policyState.killSwitchActive,
                        passed: true
                    },
                    spendLimit: {
                        limitLamports: policyState.dailySpendLimit.toString(),
                        passed: true,
                        requestedLamports: requestedAmountBn.toString(),
                        spentLamports: policyState.spentToday.toString()
                    },
                    ttl: {
                        expiresAt,
                        now,
                        passed: true
                    }
                },
                intentHash: sha256Hex(JSON.stringify(buildIntentPayload(intent, intentType, requestedAmountBn))),
                policyHash: sha256Hex(JSON.stringify(normalizePolicyState(policyState))),
                prover: "PRKT-LOCAL-v1",
                timestamp: now
            };

            const attestationHash = createHash("sha256")
                .update(JSON.stringify(attestation), "utf8")
                .digest();
            const signature = nacl.sign.detached(attestationHash, signer.secretKey);

            return {
                approved: true,
                proof: {
                    attestation,
                    publicKey: signer.publicKey.toBase58(),
                    signature
                },
                reason: "policy checks passed"
            };
        } catch (error) {
            if (error instanceof PolicyViolation) {
                throw error;
            }

            throw new ProofError(`Failed to generate policy attestation: ${error}`);
        }
    }
}

function buildIntentPayload(intent: SerializableIntent, intentType: string, requestedAmount: BN): Record<string, unknown> {
    return {
        intent: normalizeIntent(intent),
        intentType,
        requestedAmountLamports: requestedAmount.toString()
    };
}

function normalizeIntent(intent: SerializableIntent): Record<string, unknown> {
    if (intent instanceof VersionedTransaction) {
        return {
            kind: "svm",
            message: Buffer.from(intent.message.serialize()).toString("base64"),
            signatures: intent.signatures.map((signature) => Buffer.from(signature).toString("base64"))
        };
    }

    if (typeof intent.serialize === "function") {
        return {
            kind: "serialized",
            payload: normalizeValue(intent),
            serialized: Buffer.from(intent.serialize()).toString("base64")
        };
    }

    return {
        kind: "object",
        payload: normalizeValue(intent)
    };
}

function normalizePolicyState(policyState: CompressedPolicyState): Record<string, unknown> {
    return {
        agentId: policyState.agentId,
        dailySpendLimit: policyState.dailySpendLimit.toString(),
        killSwitchActive: policyState.killSwitchActive,
        lastResetTimestamp: policyState.lastResetTimestamp,
        programAllowlist: policyState.programAllowlist.map((programId) => programId.toBase58()),
        sessionTTL: policyState.sessionTTL,
        spentToday: policyState.spentToday.toString()
    };
}

function normalizeValue(value: unknown): unknown {
    if (typeof value === "bigint") {
        return value.toString();
    }

    if (value instanceof BN) {
        return value.toString();
    }

    if (value instanceof PublicKey) {
        return value.toBase58();
    }

    if (value instanceof Uint8Array) {
        return Buffer.from(value).toString("base64");
    }

    if (Array.isArray(value)) {
        return value.map((entry) => normalizeValue(entry));
    }

    if (value && typeof value === "object") {
        const normalizedEntries = Object.entries(value as Record<string, unknown>)
            .filter(([, entry]) => typeof entry !== "function")
            .map(([key, entry]) => [key, normalizeValue(entry)]);
        return Object.fromEntries(normalizedEntries);
    }

    return value;
}

function extractProgramsSeen(intent: SerializableIntent): string[] {
    if (!(intent instanceof VersionedTransaction)) {
        return [];
    }

    const seen = new Set<string>();
    for (const instruction of intent.message.compiledInstructions) {
        const programId = intent.message.staticAccountKeys[instruction.programIdIndex];
        if (programId) {
            seen.add(programId.toBase58());
        }
    }

    return Array.from(seen);
}

function sha256Hex(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}
