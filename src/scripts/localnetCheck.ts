import { Connection } from "@solana/web3.js";
import { getRpcUrl } from "../config/env";
import { WalletManager } from "../wallet/WalletManager";

async function main(): Promise<void> {
    try {
        const rpcUrl = getRpcUrl();
        console.log(`RPC URL: ${rpcUrl}`);

        const walletManager = WalletManager.loadConfigured();
        console.log(`Wallet pubkey: ${walletManager.publicKey.toBase58()}`);
        console.log(`Wallet source: ${walletManager.source}`);

        const connection = new Connection(rpcUrl, "confirmed");
        const balance = await connection.getBalance(walletManager.publicKey);
        console.log(`Balance: ${balance / 1_000_000_000} SOL (${balance} lamports)`);

        console.log("Localnet connectivity check PASSED.");
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Localnet check FAILED: ${message}`);
        if (error instanceof Error && error.stack) {
            console.error(error.stack);
        }
        process.exitCode = 1;
    }
}

main();
