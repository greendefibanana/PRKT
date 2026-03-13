import type { SupportedProtocol } from "../../types/policy";
import type { MarketSnapshot } from "../../defi/types";

export type TransferSolIntent = {
  type: "transfer-sol";
  to: string;
  lamports: number;
};

export type TransferSplIntent = {
  type: "transfer-spl";
  mint: string;
  toOwner: string;
  amountRaw: bigint;
};

export type CreateAtaIntent = {
  type: "create-ata";
  mint: string;
  owner: string;
};

export type MintTokenIntent = {
  type: "mint-token";
  mint: string;
  toOwner: string;
  amountRaw: bigint;
};

export type WriteMemoIntent = {
  type: "write-memo";
  memo: string;
};

export type DeFiCapabilityIntent = {
  type: "defi-capability";
  capability: "trade" | "lp" | "lending" | "borrowing" | "yield" | "staking";
  protocol?: SupportedProtocol;
  snapshot: MarketSnapshot;
};

export type AgentIntent =
  | TransferSolIntent
  | TransferSplIntent
  | CreateAtaIntent
  | MintTokenIntent
  | WriteMemoIntent
  | DeFiCapabilityIntent;
