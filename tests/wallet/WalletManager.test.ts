import { EnvConfigError, getOptionalSecretKey } from "../../src/config/env";
import { WalletManager } from "../../src/wallet/WalletManager";

describe("WalletManager", () => {
  const originalPrivateKey = process.env.AGENT_PRIVATE_KEY;
  const originalRemoteSignerBearerToken = process.env.REMOTE_SIGNER_BEARER_TOKEN;
  const originalRemoteSignerPubkey = process.env.REMOTE_SIGNER_PUBKEY;
  const originalRemoteSignerUrl = process.env.REMOTE_SIGNER_URL;

  afterEach(() => {
    if (originalPrivateKey === undefined) {
      delete process.env.AGENT_PRIVATE_KEY;
    } else {
      process.env.AGENT_PRIVATE_KEY = originalPrivateKey;
    }

    if (originalRemoteSignerBearerToken === undefined) {
      delete process.env.REMOTE_SIGNER_BEARER_TOKEN;
    } else {
      process.env.REMOTE_SIGNER_BEARER_TOKEN = originalRemoteSignerBearerToken;
    }

    if (originalRemoteSignerPubkey === undefined) {
      delete process.env.REMOTE_SIGNER_PUBKEY;
    } else {
      process.env.REMOTE_SIGNER_PUBKEY = originalRemoteSignerPubkey;
    }

    if (originalRemoteSignerUrl === undefined) {
      delete process.env.REMOTE_SIGNER_URL;
    } else {
      process.env.REMOTE_SIGNER_URL = originalRemoteSignerUrl;
    }
  });

  it("generates a keypair when no env key is configured", () => {
    delete process.env.AGENT_PRIVATE_KEY;

    const wallet = WalletManager.loadOrGenerate();
    const publicKey = wallet.publicKey.toBase58();

    expect(publicKey.length).toBeGreaterThan(30);
    expect(wallet.toSafeSummary().source).toBe("generated");
  });

  it("rejects malformed env secret keys", () => {
    process.env.AGENT_PRIVATE_KEY = "{\"bad\":true}";

    expect(() => getOptionalSecretKey()).toThrow(EnvConfigError);
  });

  it("prefers a configured remote signer over local key generation", () => {
    delete process.env.AGENT_PRIVATE_KEY;
    process.env.REMOTE_SIGNER_URL = "https://signer.example.internal/sign";
    process.env.REMOTE_SIGNER_BEARER_TOKEN = "secret-token";
    process.env.REMOTE_SIGNER_PUBKEY = WalletManager.generate().publicKey.toBase58();

    const wallet = WalletManager.loadOrGenerate();

    expect(wallet.toSafeSummary().source).toBe("remote");
  });
});
