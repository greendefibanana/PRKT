import { DEFAULT_POLICY_PRESET, listPolicyPresetSummaries, resolvePolicyConfig } from "../../src/config/policyPresets";

describe("policy presets", () => {
  it("exposes the default preset", () => {
    expect(DEFAULT_POLICY_PRESET).toBe("auto-devnet-safe");
  });

  it("lists provider presets", () => {
    const presetNames = listPolicyPresetSummaries().map((preset) => preset.name);
    expect(presetNames).toEqual(
      expect.arrayContaining([
        "observe-only",
        "simulate-only",
        "auto-devnet-safe",
        "guarded-live",
        "custom"
      ])
    );
  });

  it("applies preset overrides on top of the base config", () => {
    const config = resolvePolicyConfig({
      agentId: "agent-1",
      presetName: "auto-devnet-safe",
      overrides: {
        allowedCloseAccountDestinations: ["Dest111111111111111111111111111111111111111"],
        allowedMints: ["Mint111111111111111111111111111111111111111"],
        approvalMode: "live",
        maxSolPerTxLamports: 12345,
        maxSplPerTxRawAmount: "999",
        sessionTtlMinutes: 5
      }
    });

    expect(config.approvalMode).toBe("live");
    expect(config.limits.maxSolPerTxLamports).toBe(12345);
    expect(config.limits.maxSplPerTxRawAmount).toBe(999n);
    expect(config.rules.allowedMintAddresses).toEqual([
      "Mint111111111111111111111111111111111111111"
    ]);
    expect(config.rules.allowedCloseAccountDestinations).toEqual([
      "Dest111111111111111111111111111111111111111"
    ]);
    expect(Date.parse(config.sessionExpiresAtIso8601)).toBeGreaterThan(Date.now());
  });
});
