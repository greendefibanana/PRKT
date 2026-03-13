export type MaxSpend = {
  lamports: number;
};

export type WhitelistedPrograms = string[];

export type SessionExpiry = {
  iso8601: string;
};

export type SupportedProtocol = "marinade" | "raydium" | "kamino" | "jupiter";

export type ProtocolPolicy = {
  allowedMarkets: string[];
  enabled: boolean;
  maxExposureLamports: number;
  maxSlippageBps: number;
  minHealthFactor?: number;
};

export type ProtocolPolicies = Partial<Record<SupportedProtocol, ProtocolPolicy>>;

export type PolicyConstraints = {
  protocolPolicies: ProtocolPolicies;
  maxSpend: MaxSpend;
  whitelistedPrograms: WhitelistedPrograms;
  sessionExpiry: SessionExpiry;
  whitelistedTransferDestinations: string[];
};
