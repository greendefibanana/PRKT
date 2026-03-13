import { Keypair } from "@solana/web3.js";
import { ethers } from "ethers";
import nacl from "tweetnacl";

export class NeonWalletBridge {
    constructor(private readonly rpcEndpoint: string) { }

    deriveEvmWallet(solanaKeypair: Keypair): ethers.Wallet {
        const derivationSeed = nacl.sign.detached(
            Buffer.from("PRKT_EVM_KEY_DERIVATION", "utf8"),
            solanaKeypair.secretKey
        );
        const privateKey = ethers.hexlify(derivationSeed.slice(0, 32));
        return new ethers.Wallet(privateKey, new ethers.JsonRpcProvider(this.rpcEndpoint));
    }

    deriveEvmAddress(solanaKeypair: Keypair): string {
        return this.deriveEvmWallet(solanaKeypair).address;
    }

    async signEvmTransaction(
        tx: Record<string, any>,
        solanaKeypair: Keypair
    ): Promise<string> {
        const provider = new ethers.JsonRpcProvider(this.rpcEndpoint);
        const wallet = this.deriveEvmWallet(solanaKeypair).connect(provider);
        const feeData = await provider.getFeeData();
        const populated = await ethers.resolveProperties({
            ...tx,
            chainId: tx.chainId ?? Number((await provider.getNetwork()).chainId),
            gasLimit: tx.gasLimit ?? await provider.estimateGas({
                ...tx,
                from: tx.from ?? wallet.address
            }),
            gasPrice: tx.gasPrice ?? feeData.gasPrice ?? ethers.parseUnits("1", "gwei"),
            nonce: tx.nonce ?? await provider.getTransactionCount(wallet.address, "pending"),
            type: tx.type ?? 0
        });

        return wallet.signTransaction(populated as ethers.TransactionRequest);
    }
}
