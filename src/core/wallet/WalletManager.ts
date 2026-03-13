import { Keypair, type PublicKey, VersionedTransaction } from "@solana/web3.js";

import { getOptionalSecretKey, getRemoteSignerConfig } from "../../config/env";

type WalletSource = "env" | "generated" | "remote";

type TransactionSigner = {
  publicKey: PublicKey;
  signTransaction(transaction: VersionedTransaction): Promise<VersionedTransaction>;
  source: WalletSource;
};

class LocalTransactionSigner implements TransactionSigner {
  constructor(
    readonly keypair: Keypair,
    readonly source: Extract<WalletSource, "env" | "generated">
  ) {}

  get publicKey(): PublicKey {
    return this.keypair.publicKey;
  }

  async signTransaction(transaction: VersionedTransaction): Promise<VersionedTransaction> {
    transaction.sign([this.keypair]);
    return transaction;
  }
}

class RemoteTransactionSigner implements TransactionSigner {
  readonly source = "remote" as const;

  constructor(
    readonly publicKey: PublicKey,
    private readonly bearerToken: string,
    private readonly url: string
  ) {}

  async signTransaction(transaction: VersionedTransaction): Promise<VersionedTransaction> {
    const response = await fetch(this.url, {
      body: JSON.stringify({
        publicKey: this.publicKey.toBase58(),
        transactionBase64: Buffer.from(transaction.serialize()).toString("base64")
      }),
      headers: {
        Authorization: `Bearer ${this.bearerToken}`,
        "Content-Type": "application/json"
      },
      method: "POST"
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `Remote signer request failed (${response.status} ${response.statusText}): ${message || "no response body"}`
      );
    }

    const payload = (await response.json()) as {
      signedTransactionBase64?: string;
      transactionBase64?: string;
    };
    const signedTransactionBase64 =
      payload.signedTransactionBase64 ?? payload.transactionBase64 ?? null;
    if (!signedTransactionBase64) {
      throw new Error("Remote signer response did not include signedTransactionBase64.");
    }

    return VersionedTransaction.deserialize(Buffer.from(signedTransactionBase64, "base64"));
  }
}

export class WalletManager {
  private constructor(private readonly signer: TransactionSigner) {}

  static generate(): WalletManager {
    return new WalletManager(new LocalTransactionSigner(Keypair.generate(), "generated"));
  }

  static loadFromEnv(): WalletManager {
    const secretKey = getOptionalSecretKey();
    if (!secretKey) {
      throw new Error("AGENT_PRIVATE_KEY is not configured.");
    }

    return new WalletManager(new LocalTransactionSigner(Keypair.fromSecretKey(secretKey), "env"));
  }

  static loadRemoteSigner(): WalletManager {
    const remoteSigner = getRemoteSignerConfig();
    if (!remoteSigner) {
      throw new Error("Remote signer is not configured.");
    }

    return new WalletManager(
      new RemoteTransactionSigner(
        remoteSigner.publicKey,
        remoteSigner.bearerToken,
        remoteSigner.url
      )
    );
  }

  static loadConfigured(): WalletManager {
    const remoteSigner = getRemoteSignerConfig();
    if (remoteSigner) {
      return new WalletManager(
        new RemoteTransactionSigner(
          remoteSigner.publicKey,
          remoteSigner.bearerToken,
          remoteSigner.url
        )
      );
    }

    return WalletManager.loadFromEnv();
  }

  static loadOrGenerate(): WalletManager {
    const remoteSigner = getRemoteSignerConfig();
    if (remoteSigner) {
      return new WalletManager(
        new RemoteTransactionSigner(
          remoteSigner.publicKey,
          remoteSigner.bearerToken,
          remoteSigner.url
        )
      );
    }

    const secretKey = getOptionalSecretKey();
    if (!secretKey) {
      return WalletManager.generate();
    }

    return new WalletManager(new LocalTransactionSigner(Keypair.fromSecretKey(secretKey), "env"));
  }

  static fromSecretKey(secretKey: Uint8Array, source: "generated" | "env" = "env"): WalletManager {
    return new WalletManager(new LocalTransactionSigner(Keypair.fromSecretKey(secretKey), source));
  }

  get payer(): Keypair {
    if (!(this.signer instanceof LocalTransactionSigner)) {
      throw new Error("This wallet uses a remote signer and does not expose a local keypair.");
    }

    return this.signer.keypair;
  }

  get publicKey(): PublicKey {
    return this.signer.publicKey;
  }

  get source(): WalletSource {
    return this.signer.source;
  }

  async signTransaction(transaction: VersionedTransaction): Promise<VersionedTransaction> {
    return this.signer.signTransaction(transaction);
  }

  toSafeSummary(): { publicKey: string; source: WalletSource } {
    return {
      publicKey: this.publicKey.toBase58(),
      source: this.source
    };
  }
}
