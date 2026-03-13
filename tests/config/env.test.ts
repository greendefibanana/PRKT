import {
  EnvConfigError,
  assertMintMatchesRpcCluster,
  detectClusterFromRpcUrl,
  getOptionalSecretKey,
  getOptionalDevnetTreasurySecretKey,
  getOnchainPolicyGuardProgramId,
  getRemoteSignerConfig,
  getZkCompressionApiUrl,
  getZkProverUrl,
  isLiveRaydiumLpEnabled,
  isUniversalDeFiLiveFirstEnabled,
  getPolicySessionTtlMinutes
} from "../../src/config/env";

describe("env cluster and mint validation", () => {
  it("detects devnet/mainnet/localnet from RPC URLs", () => {
    expect(detectClusterFromRpcUrl("https://api.devnet.solana.com")).toBe("devnet");
    expect(detectClusterFromRpcUrl("https://api.mainnet-beta.solana.com")).toBe("mainnet-beta");
    expect(detectClusterFromRpcUrl("http://127.0.0.1:8899")).toBe("localnet");
  });

  it("blocks mainnet USDC mint when RPC is devnet", () => {
    expect(() =>
      assertMintMatchesRpcCluster({
        mintAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        mintName: "USDC_MINT",
        rpcUrl: "https://api.devnet.solana.com"
      })
    ).toThrow(EnvConfigError);
  });

  it("blocks devnet USDC mint when RPC is mainnet", () => {
    expect(() =>
      assertMintMatchesRpcCluster({
        mintAddress: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        mintName: "USDC_MINT",
        rpcUrl: "https://api.mainnet-beta.solana.com"
      })
    ).toThrow(EnvConfigError);
  });

  it("allows matching devnet USDC mint on devnet", () => {
    expect(() =>
      assertMintMatchesRpcCluster({
        mintAddress: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        mintName: "USDC_MINT",
        rpcUrl: "https://api.devnet.solana.com"
      })
    ).not.toThrow();
  });
});

describe("policy session ttl env", () => {
  const originalValue = process.env.POLICY_SESSION_TTL_MINUTES;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.POLICY_SESSION_TTL_MINUTES;
    } else {
      process.env.POLICY_SESSION_TTL_MINUTES = originalValue;
    }
  });

  it("defaults to 60 minutes when unset", () => {
    delete process.env.POLICY_SESSION_TTL_MINUTES;
    expect(getPolicySessionTtlMinutes()).toBe(60);
  });

  it("reads a valid integer ttl value", () => {
    process.env.POLICY_SESSION_TTL_MINUTES = "120";
    expect(getPolicySessionTtlMinutes()).toBe(120);
  });

  it("rejects invalid ttl values", () => {
    process.env.POLICY_SESSION_TTL_MINUTES = "0";
    expect(() => getPolicySessionTtlMinutes()).toThrow(EnvConfigError);
  });
});

describe("universal defi env flags", () => {
  const originalLiveRaydium = process.env.ENABLE_LIVE_RAYDIUM_LP;
  const originalLiveFirst = process.env.UNIVERSAL_DEFI_LIVE_FIRST;

  afterEach(() => {
    if (originalLiveRaydium === undefined) {
      delete process.env.ENABLE_LIVE_RAYDIUM_LP;
    } else {
      process.env.ENABLE_LIVE_RAYDIUM_LP = originalLiveRaydium;
    }

    if (originalLiveFirst === undefined) {
      delete process.env.UNIVERSAL_DEFI_LIVE_FIRST;
    } else {
      process.env.UNIVERSAL_DEFI_LIVE_FIRST = originalLiveFirst;
    }
  });

  it("parses ENABLE_LIVE_RAYDIUM_LP", () => {
    process.env.ENABLE_LIVE_RAYDIUM_LP = "true";
    expect(isLiveRaydiumLpEnabled()).toBe(true);

    process.env.ENABLE_LIVE_RAYDIUM_LP = "0";
    expect(isLiveRaydiumLpEnabled()).toBe(false);
  });

  it("defaults UNIVERSAL_DEFI_LIVE_FIRST to true", () => {
    delete process.env.UNIVERSAL_DEFI_LIVE_FIRST;
    expect(isUniversalDeFiLiveFirstEnabled()).toBe(true);
  });
});

describe("remote signer env", () => {
  const originalBearerToken = process.env.REMOTE_SIGNER_BEARER_TOKEN;
  const originalPubkey = process.env.REMOTE_SIGNER_PUBKEY;
  const originalUrl = process.env.REMOTE_SIGNER_URL;

  afterEach(() => {
    if (originalBearerToken === undefined) {
      delete process.env.REMOTE_SIGNER_BEARER_TOKEN;
    } else {
      process.env.REMOTE_SIGNER_BEARER_TOKEN = originalBearerToken;
    }

    if (originalPubkey === undefined) {
      delete process.env.REMOTE_SIGNER_PUBKEY;
    } else {
      process.env.REMOTE_SIGNER_PUBKEY = originalPubkey;
    }

    if (originalUrl === undefined) {
      delete process.env.REMOTE_SIGNER_URL;
    } else {
      process.env.REMOTE_SIGNER_URL = originalUrl;
    }
  });

  it("returns null when no remote signer vars are configured", () => {
    delete process.env.REMOTE_SIGNER_URL;
    delete process.env.REMOTE_SIGNER_BEARER_TOKEN;
    delete process.env.REMOTE_SIGNER_PUBKEY;

    expect(getRemoteSignerConfig()).toBeNull();
  });

  it("requires all remote signer vars together", () => {
    process.env.REMOTE_SIGNER_URL = "https://signer.example.internal/sign";
    delete process.env.REMOTE_SIGNER_BEARER_TOKEN;
    delete process.env.REMOTE_SIGNER_PUBKEY;

    expect(() => getRemoteSignerConfig()).toThrow(EnvConfigError);
  });
});

describe("devnet treasury env", () => {
  const originalTreasuryKey = process.env.DEVNET_TREASURY_PRIVATE_KEY;

  afterEach(() => {
    if (originalTreasuryKey === undefined) {
      delete process.env.DEVNET_TREASURY_PRIVATE_KEY;
    } else {
      process.env.DEVNET_TREASURY_PRIVATE_KEY = originalTreasuryKey;
    }
  });

  it("returns null when no treasury key is configured", () => {
    delete process.env.DEVNET_TREASURY_PRIVATE_KEY;
    expect(getOptionalDevnetTreasurySecretKey()).toBeNull();
  });

  it("rejects malformed treasury secret keys", () => {
    process.env.DEVNET_TREASURY_PRIVATE_KEY = "{\"bad\":true}";
    expect(() => getOptionalDevnetTreasurySecretKey()).toThrow(EnvConfigError);
  });

  it("treats empty placeholder arrays as unset", () => {
    process.env.DEVNET_TREASURY_PRIVATE_KEY = "[]";
    process.env.AGENT_PRIVATE_KEY = "[]";

    expect(getOptionalDevnetTreasurySecretKey()).toBeNull();
    expect(getOptionalSecretKey()).toBeNull();
  });
});

describe("zk compression env", () => {
  const originalApiUrl = process.env.ZK_COMPRESSION_API_URL;
  const originalProverUrl = process.env.ZK_PROVER_URL;

  afterEach(() => {
    if (originalApiUrl === undefined) {
      delete process.env.ZK_COMPRESSION_API_URL;
    } else {
      process.env.ZK_COMPRESSION_API_URL = originalApiUrl;
    }

    if (originalProverUrl === undefined) {
      delete process.env.ZK_PROVER_URL;
    } else {
      process.env.ZK_PROVER_URL = originalProverUrl;
    }
  });

  it("returns null when live zk compression endpoints are unset", () => {
    delete process.env.ZK_COMPRESSION_API_URL;
    delete process.env.ZK_PROVER_URL;

    expect(getZkCompressionApiUrl()).toBeNull();
    expect(getZkProverUrl()).toBeNull();
  });

  it("reads configured live zk compression endpoints", () => {
    process.env.ZK_COMPRESSION_API_URL = "https://compression.devnet.example.com";
    process.env.ZK_PROVER_URL = "https://prover.devnet.example.com";

    expect(getZkCompressionApiUrl()).toBe("https://compression.devnet.example.com");
    expect(getZkProverUrl()).toBe("https://prover.devnet.example.com");
  });
});

describe("onchain policy guard env", () => {
  const originalProgramId = process.env.ONCHAIN_POLICY_GUARD_PROGRAM_ID;

  afterEach(() => {
    if (originalProgramId === undefined) {
      delete process.env.ONCHAIN_POLICY_GUARD_PROGRAM_ID;
    } else {
      process.env.ONCHAIN_POLICY_GUARD_PROGRAM_ID = originalProgramId;
    }
  });

  it("returns null when the onchain program id is unset", () => {
    delete process.env.ONCHAIN_POLICY_GUARD_PROGRAM_ID;
    expect(getOnchainPolicyGuardProgramId()).toBeNull();
  });

  it("reads the configured onchain program id", () => {
    process.env.ONCHAIN_POLICY_GUARD_PROGRAM_ID = "3sUkfLW4jtwSQFgdtWyEj8FPedtvKfXSB1J16PMUZhMG";
    expect(getOnchainPolicyGuardProgramId()).toBe("3sUkfLW4jtwSQFgdtWyEj8FPedtvKfXSB1J16PMUZhMG");
  });
});
