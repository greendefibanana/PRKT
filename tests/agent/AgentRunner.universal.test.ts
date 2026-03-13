import { Keypair } from "@solana/web3.js";

import { AgentRunner } from "../../src/agent/runner/AgentRunner";
import { createDefaultPolicyConfig } from "../../src/config/agentPolicies";
import { BalanceService } from "../../src/core/balances/BalanceService";
import { RpcClient } from "../../src/core/rpc/RpcClient";
import { TokenService } from "../../src/core/tokens/TokenService";
import { TransactionService } from "../../src/core/transactions/TransactionService";
import { WalletManager } from "../../src/core/wallet/WalletManager";
import type { Strategy } from "../../src/agent/types/AgentContext";

describe("AgentRunner universal DeFi intent", () => {
  it("executes defi-capability intents through universal executor", async () => {
    const rpcClient = new RpcClient("https://api.devnet.solana.com", "confirmed");
    const tokenService = new TokenService(rpcClient);
    const strategy: Strategy = {
      name: "test-universal",
      nextIntents: async () => [
        {
          type: "defi-capability",
          capability: "trade",
          snapshot: {
            buyThresholdUsd: 100,
            solPriceUsd: 95
          }
        }
      ]
    };

    const runner = new AgentRunner();
    const wallet = WalletManager.generate();
    runner.registerAgent({
      context: {
        id: "agent-test-universal",
        walletManager: wallet,
        walletPublicKey: wallet.publicKey,
        rpcClient,
        transactionService: new TransactionService(rpcClient),
        tokenService,
        balanceService: new BalanceService(rpcClient, tokenService),
        policyConfig: createDefaultPolicyConfig({
          agentId: "agent-test-universal"
        }),
        logger: () => undefined,
        universalDeFiExecutor: {
          execute: async () => ({
            capability: "trade",
            protocol: "jupiter",
            result: {
              action: "trade",
              memo: "mock",
              mock: true,
              protocol: "jupiter",
              signature: Keypair.generate().publicKey.toBase58()
            }
          })
        }
      },
      strategy
    });

    const results = await runner.runOnceParallel();
    expect(results).toHaveLength(1);
    expect(results[0].outcomes).toHaveLength(1);
    expect(results[0].outcomes[0].allowed).toBe(true);
    expect(results[0].outcomes[0].signature).toBeTruthy();
  });
});
