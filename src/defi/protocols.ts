import type { SupportedProtocol } from "../types/policy";

export type ProtocolPreset = {
  defaultMarketId: string;
  description: string;
  label: string;
  protocol: SupportedProtocol;
};

export const PROTOCOL_PRESETS: Record<SupportedProtocol, ProtocolPreset> = {
  jupiter: {
    defaultMarketId: "sol-usdc",
    description: "Spot swap routing for token rebalancing.",
    label: "Jupiter",
    protocol: "jupiter"
  },
  kamino: {
    defaultMarketId: "main-usdc-vault",
    description: "Yield and lending posture for idle stablecoin capital.",
    label: "Kamino",
    protocol: "kamino"
  },
  marinade: {
    defaultMarketId: "primary-stake-pool",
    description: "Liquid staking posture for idle SOL reserves.",
    label: "Marinade",
    protocol: "marinade"
  },
  raydium: {
    defaultMarketId: "sol-usdc-core-pool",
    description: "AMM liquidity posture for SOL/USDC LP management.",
    label: "Raydium",
    protocol: "raydium"
  }
};
