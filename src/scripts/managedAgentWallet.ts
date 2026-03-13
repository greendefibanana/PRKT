import type { PublicKey } from "@solana/web3.js";

import { AgentRegistryStore } from "../cli/services/agentRegistry";
import { WalletRegistry } from "../cli/services/walletRegistry";
import type { StoredAgentRecord, StoredWalletRecord } from "../cli/types";
import { BalanceService } from "../core/balances/BalanceService";
import { DevnetFundingService } from "../core/funding/DevnetFundingService";
import { WalletManager } from "../wallet/WalletManager";
import { ensureWalletHasMinimumSol } from "./devnetFunding";

const AGENT_NAME_ENV = "PRKT_AGENT_NAME";
const OWNER_ID_ENV = "PRKT_OWNER_ID";

export type ManagedAgentWallet = {
  agent: StoredAgentRecord;
  agentName: string;
  createdAgent: boolean;
  createdWallet: boolean;
  recoveryKey: string | null;
  wallet: StoredWalletRecord;
  walletManager: WalletManager;
};

export function getManagedAgentName(input: {
  defaultAgentName: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const configuredName = input.env?.[AGENT_NAME_ENV]?.trim();
  if (configuredName) {
    return configuredName;
  }

  return input.defaultAgentName;
}

export function getManagedOwnerId(env?: NodeJS.ProcessEnv): string | undefined {
  const configuredOwnerId = env?.[OWNER_ID_ENV]?.trim();
  return configuredOwnerId && configuredOwnerId.length > 0 ? configuredOwnerId : undefined;
}

export function resolveManagedAgentWallet(input: {
  agentName: string;
  ownerId?: string;
  agentRegistry?: AgentRegistryStore;
  walletRegistry?: WalletRegistry;
}): ManagedAgentWallet {
  const walletRegistry = input.walletRegistry ?? new WalletRegistry();
  const agentRegistry = input.agentRegistry ?? new AgentRegistryStore(walletRegistry);

  let wallet = walletRegistry.find(input.agentName);
  let recoveryKey: string | null = null;
  const createdWallet = !wallet;
  if (!wallet) {
    const provisioned = walletRegistry.create(input.agentName);
    wallet = provisioned.record;
    recoveryKey = provisioned.recoveryKey;
  }

  let agent = agentRegistry.find(input.agentName);
  const createdAgent = !agent;
  if (!agent) {
    agent = agentRegistry.createAgent({
      agentId: input.agentName,
      ownerId: input.ownerId,
      walletName: wallet.name
    });
  }

  return {
    agent,
    agentName: agent.name,
    createdAgent,
    createdWallet,
    recoveryKey,
    wallet,
    walletManager: walletRegistry.toWalletManager(wallet.name)
  };
}

export async function ensureManagedAgentWalletFunding(input: {
  balanceService: BalanceService;
  fundingService: DevnetFundingService;
  minimumSol: number;
  publicKey: PublicKey;
}): Promise<void> {
  await ensureWalletHasMinimumSol({
    balanceService: input.balanceService,
    fundingService: input.fundingService,
    minimumSol: input.minimumSol,
    publicKey: input.publicKey
  });
}

export function logManagedAgentWallet(input: ManagedAgentWallet): void {
  console.log(`Agent: ${input.agent.name}`);
  if (input.agent.ownerId) {
    console.log(`Owner: ${input.agent.ownerId}`);
  }
  console.log(`Wallet: ${input.wallet.publicKey}`);
  console.log(`Wallet source: managed-registry`);
  if (input.createdWallet) {
    console.log("Wallet provisioning: created persistent wallet for agent");
  } else {
    console.log("Wallet provisioning: reused persistent wallet for agent");
  }
  if (input.createdAgent) {
    console.log("Agent provisioning: created agent-to-wallet assignment");
  }
  if (input.recoveryKey) {
    console.log(`Recovery key: ${input.recoveryKey}`);
  }
}
