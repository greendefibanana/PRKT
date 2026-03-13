import {
    Connection,
    type Commitment,
    type ConfirmOptions,
    type PublicKey,
    type RpcResponseAndContext,
    type SignatureResult,
    type SimulatedTransactionResponse,
    type TransactionConfirmationStrategy,
    type VersionedTransaction
} from "@solana/web3.js";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 4000;

export type RpcFailoverConfig = {
    primaryUrl: string;
    fallbackUrl?: string | null;
    commitment?: Commitment;
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
};

/**
 * RPC client with automatic failover from primary to fallback URL,
 * exponential backoff, and random jitter on retries.
 */
export class RpcFailoverClient {
    private primaryConnection: Connection;
    private fallbackConnection: Connection | null;
    private readonly maxRetries: number;
    private readonly baseDelayMs: number;
    private readonly maxDelayMs: number;
    private readonly commitment: Commitment;
    readonly primaryUrl: string;
    readonly fallbackUrl: string | null;

    constructor(config: RpcFailoverConfig) {
        this.commitment = config.commitment ?? "confirmed";
        this.primaryUrl = config.primaryUrl;
        this.fallbackUrl = config.fallbackUrl ?? null;
        this.primaryConnection = new Connection(config.primaryUrl, this.commitment);
        this.fallbackConnection = config.fallbackUrl
            ? new Connection(config.fallbackUrl, this.commitment)
            : null;
        this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
        this.baseDelayMs = config.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
        this.maxDelayMs = config.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    }

    get connection(): Connection {
        return this.primaryConnection;
    }

    get rpcUrl(): string {
        return this.primaryConnection.rpcEndpoint;
    }

    async getLatestBlockhash(commitment: Commitment = "confirmed"): Promise<{
        blockhash: string;
        lastValidBlockHeight: number;
    }> {
        return this.executeWithFailover((conn) => conn.getLatestBlockhash(commitment));
    }

    async getBalance(publicKey: PublicKey, commitment: Commitment = "confirmed"): Promise<number> {
        return this.executeWithFailover((conn) => conn.getBalance(publicKey, commitment));
    }

    async getTokenAccountBalance(publicKey: PublicKey, commitment: Commitment = "confirmed") {
        return this.executeWithFailover((conn) =>
            conn.getTokenAccountBalance(publicKey, commitment)
        );
    }

    async getAccountInfo(publicKey: PublicKey, commitment: Commitment = "confirmed") {
        return this.executeWithFailover((conn) =>
            conn.getAccountInfo(publicKey, commitment)
        );
    }

    async sendTransaction(
        transaction: VersionedTransaction,
        options?: ConfirmOptions
    ): Promise<string> {
        return this.executeWithFailover((conn) => conn.sendTransaction(transaction, options));
    }

    async confirmTransaction(
        strategy: TransactionConfirmationStrategy | string,
        commitment: Commitment = "confirmed"
    ): Promise<RpcResponseAndContext<SignatureResult>> {
        return this.executeWithFailover((conn) =>
            conn.confirmTransaction(strategy as TransactionConfirmationStrategy, commitment)
        );
    }

    async simulateTransaction(
        transaction: VersionedTransaction,
        options?: {
            commitment?: Commitment;
            sigVerify?: boolean;
        }
    ): Promise<RpcResponseAndContext<SimulatedTransactionResponse>> {
        return this.executeWithFailover((conn) =>
            conn.simulateTransaction(transaction, {
                commitment: options?.commitment ?? "confirmed",
                sigVerify: options?.sigVerify ?? true
            })
        );
    }

    async requestAirdrop(publicKey: PublicKey, lamports: number): Promise<string> {
        return this.executeWithFailover((conn) => conn.requestAirdrop(publicKey, lamports));
    }

    private async executeWithFailover<T>(
        operation: (connection: Connection) => Promise<T>
    ): Promise<T> {
        const connections = [this.primaryConnection];
        if (this.fallbackConnection) {
            connections.push(this.fallbackConnection);
        }

        let lastError: Error | null = null;

        for (const conn of connections) {
            for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
                try {
                    return await operation(conn);
                } catch (error: unknown) {
                    lastError = error instanceof Error ? error : new Error(String(error));

                    if (attempt < this.maxRetries - 1) {
                        await this.backoff(attempt);
                    }
                }
            }
        }

        throw lastError ?? new Error("RPC failover exhausted all retries on all endpoints.");
    }

    private async backoff(attempt: number): Promise<void> {
        const exponentialDelay = this.baseDelayMs * Math.pow(2, attempt);
        const cappedDelay = Math.min(exponentialDelay, this.maxDelayMs);
        const jitter = Math.random() * cappedDelay * 0.3;
        const totalDelay = cappedDelay + jitter;

        await new Promise<void>((resolve) => {
            setTimeout(resolve, totalDelay);
        });
    }
}
