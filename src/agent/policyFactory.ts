import { SystemProgram } from "@solana/web3.js";

import { getExtraWhitelistedPrograms, getPolicySessionTtlMinutes } from "../config/env";
import type { PolicyConstraints } from "../types/policy";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MEMO_PROGRAM_ID,
  TOKEN_PROGRAM_ID
} from "../solana/programs";

export function createDefaultAgentPolicy(overrides?: Partial<PolicyConstraints>): PolicyConstraints {
  const sessionTtlMinutes = getPolicySessionTtlMinutes();
  const sessionExpiryIso = new Date(Date.now() + sessionTtlMinutes * 60_000).toISOString();

  return {
    protocolPolicies: {
      kamino: {
        allowedMarkets: ["main-usdc-vault"],
        enabled: true,
        maxExposureLamports: 1_000_000_000,
        maxSlippageBps: 75,
        minHealthFactor: 1.5
      },
      jupiter: {
        allowedMarkets: ["sol-usdc"],
        enabled: true,
        maxExposureLamports: 1_000_000_000,
        maxSlippageBps: 100
      },
      marinade: {
        allowedMarkets: ["primary-stake-pool"],
        enabled: true,
        maxExposureLamports: 1_000_000_000,
        maxSlippageBps: 50
      },
      raydium: {
        allowedMarkets: ["sol-usdc-core-pool"],
        enabled: true,
        maxExposureLamports: 1_000_000_000,
        maxSlippageBps: 100
      }
    },
    maxSpend: {
      lamports: 1_000_000
    },
    whitelistedPrograms: [
      SystemProgram.programId.toBase58(),
      TOKEN_PROGRAM_ID.toBase58(),
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
      MEMO_PROGRAM_ID.toBase58(),
      ...getExtraWhitelistedPrograms()
    ],
    sessionExpiry: {
      iso8601: sessionExpiryIso
    },
    whitelistedTransferDestinations: [],
    ...overrides
  };
}
