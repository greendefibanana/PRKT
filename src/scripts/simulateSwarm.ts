import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction
} from "@solana/web3.js";

import { createDefaultAgentPolicy } from "../agent/policyFactory";
import { PolicyGuard } from "../policy/PolicyGuard";
import { SecurityViolationError } from "../policy/errors";
import { KoraSigner } from "../kora/KoraSigner";
import type { PolicyConstraints } from "../types/policy";
import { MOCK_BLOCKHASH } from "../solana/programs";
import { WalletManager } from "../wallet/WalletManager";
import { createKoraSigner } from "./shared";
import { printDemoMode } from "./mode";

type SwarmRole = {
  description: string;
  id: string;
  memo: string;
  policy: PolicyConstraints;
  runBlockedProbe?: boolean;
};

function log(agentId: string, message: string): void {
  console.log(`[swarm][${agentId}] ${message}`);
}

function createTransferProbe(
  walletManager: WalletManager,
  destination: string,
  lamports: number
): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: walletManager.publicKey,
    recentBlockhash: MOCK_BLOCKHASH,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: walletManager.publicKey,
        toPubkey: new PublicKey(destination),
        lamports
      })
    ]
  }).compileToV0Message();

  const transaction = new VersionedTransaction(message);
  transaction.sign([walletManager.payer]);

  return transaction;
}

async function runRole(role: SwarmRole, koraSigner: KoraSigner): Promise<void> {
  const walletManager = WalletManager.generate();
  const policyGuard = new PolicyGuard(role.policy);

  log(role.id, `Role: ${role.description}`);
  log(role.id, `Wallet: ${walletManager.publicKey.toBase58()}`);
  log(role.id, `Policy max spend: ${role.policy.maxSpend.lamports} lamports`);
  log(
    role.id,
    `Policy transfer whitelist: ${role.policy.whitelistedTransferDestinations.length} destination(s)`
  );
  log(role.id, "Policy check starting.");

  if (role.runBlockedProbe) {
    try {
      const blockedProbe = createTransferProbe(
        walletManager,
        Keypair.generate().publicKey.toBase58(),
        100_000
      );
      policyGuard.validate(blockedProbe);
      log(role.id, "Strict whitelist probe unexpectedly passed.");
    } catch (error: unknown) {
      if (error instanceof SecurityViolationError) {
        log(role.id, `Strict whitelist probe blocked as expected: ${error.message}`);
      } else {
        throw error;
      }
    }
  }

  const transaction = await koraSigner.buildMemoTransaction(walletManager, role.memo);
  policyGuard.validate(transaction);
  log(role.id, "Policy check passed. Executing gasless action.");

  const execution = await koraSigner.signAndSendGasless(transaction, role.memo);
  log(
    role.id,
    `Execution complete (${execution.mock ? "mock" : "live"}): ${execution.signature}`
  );
}

async function main(): Promise<void> {
  printDemoMode("SIMULATED", "Multi-agent memo execution and policy probes");
  console.log("PRKT swarm simulation");
  console.log("Spawning 3 distinct agent wallets and executing in parallel.");

  const koraSigner = createKoraSigner();
  const liquidationVault = Keypair.generate().publicKey.toBase58();
  const roles: SwarmRole[] = [
    {
      description: "High-frequency operator (low spend limit)",
      id: "agent-1",
      memo: "HFT heartbeat: rebalance window open",
      policy: createDefaultAgentPolicy({
        maxSpend: {
          lamports: 50_000
        }
      })
    },
    {
      description: "Long-term staker (high spend limit)",
      id: "agent-2",
      memo: "Staker review: epoch position healthy",
      policy: createDefaultAgentPolicy({
        maxSpend: {
          lamports: 10_000_000
        }
      })
    },
    {
      description: "Liquidator (strict whitelist)",
      id: "agent-3",
      memo: "Liquidator check: liquidation opportunity queued",
      policy: createDefaultAgentPolicy({
        maxSpend: {
          lamports: 250_000
        },
        whitelistedTransferDestinations: [liquidationVault]
      }),
      runBlockedProbe: true
    }
  ];

  await Promise.all(roles.map(async (role) => runRole(role, koraSigner)));

  console.log("Swarm simulation complete.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Swarm simulation failed: ${message}`);
  process.exitCode = 1;
});
