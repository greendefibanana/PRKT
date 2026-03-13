import { PublicKey } from "@solana/web3.js";

import { AgentRunner } from "../../agent/runner/AgentRunner";
import { getRpcUrl, isUniversalDeFiLiveFirstEnabled } from "../../config/env";
import { resolvePolicyConfig } from "../../config/policyPresets";
import { BalanceService } from "../../core/balances/BalanceService";
import { RpcClient } from "../../core/rpc/RpcClient";
import { TokenService } from "../../core/tokens/TokenService";
import { TransactionService } from "../../core/transactions/TransactionService";
import { UniversalDeFiOrchestrator } from "../../defi/universal";
import { createKoraSigner } from "../../scripts/shared";
import type { AgentRunResult } from "../../agent/runner/AgentRunner";
import type { StoredAgentRecord } from "../types";
import { WalletRegistry } from "./walletRegistry";
import { createStrategy } from "./strategyFactory";

export async function runAgentOnce(input: {
  agent: StoredAgentRecord;
  overrideStrategy?: string;
}): Promise<AgentRunResult> {
  const walletRegistry = new WalletRegistry();
  const walletManager = walletRegistry.toWalletManager(input.agent.walletName);
  const rpcClient = new RpcClient(getRpcUrl(), "confirmed");
  const tokenService = new TokenService(rpcClient);
  const transactionService = new TransactionService(rpcClient);
  const balanceService = new BalanceService(rpcClient, tokenService);
  const universalDeFi = new UniversalDeFiOrchestrator({
    koraSigner: createKoraSigner(),
    liveFirst: isUniversalDeFiLiveFirstEnabled(),
    walletManager
  });

  const runner = new AgentRunner();
  const policyConfig = resolvePolicyConfig({
    agentId: input.agent.name,
    overrides: input.agent.policyOverrides,
    presetName: input.agent.policyPreset
  });
  runner.registerAgent({
    context: {
      id: input.agent.name,
      walletManager,
      walletPublicKey: new PublicKey(walletManager.publicKey.toBase58()),
      rpcClient,
      transactionService,
      tokenService,
      balanceService,
      policyConfig: policyConfig,
      logger: () => undefined,
      universalDeFiExecutor: universalDeFi
    },
    strategy: createStrategy({
      name: input.overrideStrategy ?? input.agent.strategy,
      config: input.agent.strategyConfig
    }),
    approvalMode: policyConfig.approvalMode
  });

  const [result] = await runner.runOnceParallel();
  return result;
}
