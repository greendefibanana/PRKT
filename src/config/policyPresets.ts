import type { PolicyConfig } from "../policy";
import { createDefaultPolicyConfig } from "./agentPolicies";
import type { PolicyPresetName, StoredPolicyOverrides } from "../cli/types";

type PolicyPresetDefinition = {
  description: string;
  label: string;
  build: (input: { agentId: string }) => PolicyConfig;
};

export const POLICY_PRESETS: Record<PolicyPresetName, PolicyPresetDefinition> = {
  "observe-only": {
    label: "Observe Only",
    description: "Blocks broadcasts while still allowing inspection and monitoring.",
    build: ({ agentId }) =>
      createDefaultPolicyConfig({
        agentId,
        maxTransactionsPerDay: 0,
        maxTransactionsPerSession: 0
      })
  },
  "simulate-only": {
    label: "Simulate Only",
    description: "Safe simulation-first mode with conservative limits for testing.",
    build: ({ agentId }) =>
      createDefaultPolicyConfig({
        agentId,
        maxSolPerTxLamports: 100_000_000,
        maxSplPerTxRawAmount: 100_000_000n,
        maxTransactionsPerDay: 25,
        maxTransactionsPerSession: 5
      })
  },
  "auto-devnet-safe": {
    label: "Auto Devnet Safe",
    description: "Default autonomous devnet profile with conservative per-tx and per-session limits.",
    build: ({ agentId }) =>
      createDefaultPolicyConfig({
        agentId,
        maxSolPerTxLamports: 300_000_000,
        maxSplPerTxRawAmount: 1_000_000_000n,
        maxTransactionsPerDay: 20,
        maxTransactionsPerSession: 5
      })
  },
  "guarded-live": {
    label: "Guarded Live",
    description: "Manual-approval profile for higher-risk live execution.",
    build: ({ agentId }) =>
      createDefaultPolicyConfig({
        agentId,
        approvalMode: "live",
        maxSolPerTxLamports: 1_000_000_000,
        maxSplPerTxRawAmount: 5_000_000_000n,
        maxTransactionsPerDay: 50,
        maxTransactionsPerSession: 10
      })
  },
  custom: {
    label: "Custom",
    description: "Custom policy built from provider defaults plus explicit overrides.",
    build: ({ agentId }) => createDefaultPolicyConfig({ agentId })
  }
};

export const DEFAULT_POLICY_PRESET: PolicyPresetName = "auto-devnet-safe";

export function listPolicyPresetSummaries(): Array<{
  description: string;
  label: string;
  name: PolicyPresetName;
}> {
  return (Object.entries(POLICY_PRESETS) as Array<[PolicyPresetName, PolicyPresetDefinition]>).map(
    ([name, preset]) => ({
      description: preset.description,
      label: preset.label,
      name
    })
  );
}

export function resolvePolicyConfig(input: {
  agentId: string;
  overrides?: StoredPolicyOverrides;
  presetName: PolicyPresetName;
}): PolicyConfig {
  const base = POLICY_PRESETS[input.presetName].build({
    agentId: input.agentId
  });
  const overrides = input.overrides;
  if (!overrides) {
    return base;
  }

  const ttlMinutes = overrides.sessionTtlMinutes ?? null;
  const sessionExpiresAtIso8601 =
    ttlMinutes === null
      ? base.sessionExpiresAtIso8601
      : new Date(Date.now() + ttlMinutes * 60_000).toISOString();

  return {
    ...base,
    approvalMode: overrides.approvalMode ?? base.approvalMode,
    sessionExpiresAtIso8601,
    limits: {
      ...base.limits,
      maxSolPerTxLamports: overrides.maxSolPerTxLamports ?? base.limits.maxSolPerTxLamports,
      maxSplPerTxRawAmount:
        overrides.maxSplPerTxRawAmount !== undefined
          ? BigInt(overrides.maxSplPerTxRawAmount)
          : base.limits.maxSplPerTxRawAmount,
      maxTransactionsPerDay:
        overrides.maxTransactionsPerDay ?? base.limits.maxTransactionsPerDay,
      maxTransactionsPerSession:
        overrides.maxTransactionsPerSession ?? base.limits.maxTransactionsPerSession
    },
    rules: {
      ...base.rules,
      allowOpaqueProgramIds:
        overrides.allowOpaqueProgramIds ?? base.rules.allowOpaqueProgramIds,
      allowedCloseAccountDestinations:
        overrides.allowedCloseAccountDestinations ?? base.rules.allowedCloseAccountDestinations,
      allowedMintAddresses: overrides.allowedMints ?? base.rules.allowedMintAddresses,
      allowedProgramIds: [
        ...base.rules.allowedProgramIds,
        ...(overrides.extraAllowedProgramIds ?? [])
      ],
      allowedTransferDestinations:
        overrides.allowedTransferDestinations ?? base.rules.allowedTransferDestinations,
      denyUnknownInstructionsByDefault:
        overrides.denyUnknownInstructionsByDefault ?? base.rules.denyUnknownInstructionsByDefault,
      rejectSuspiciousBalanceDeltas:
        overrides.rejectSuspiciousBalanceDeltas ?? base.rules.rejectSuspiciousBalanceDeltas,
      requireSimulationSuccess:
        overrides.requireSimulationSuccess ?? base.rules.requireSimulationSuccess
    }
  };
}
