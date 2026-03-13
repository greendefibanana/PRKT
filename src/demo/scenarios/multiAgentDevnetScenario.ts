import { AgentRunner } from "../../agent/runner/AgentRunner";
import { MemoHeartbeatStrategy } from "../../agent/strategies/MemoHeartbeatStrategy";
import { SimpleScriptedTransferStrategy } from "../../agent/strategies/SimpleScriptedTransferStrategy";
import { TreasuryDistributorStrategy } from "../../agent/strategies/TreasuryDistributorStrategy";
import { createDefaultPolicyConfig } from "../../config/agentPolicies";
import { getRpcUrl } from "../../config/env";
import { BalanceService } from "../../core/balances/BalanceService";
import { DevnetFundingService } from "../../core/funding/DevnetFundingService";
import { RpcClient } from "../../core/rpc/RpcClient";
import { TokenService } from "../../core/tokens/TokenService";
import { TransactionService } from "../../core/transactions/TransactionService";
import { ensureManagedAgentWalletFunding, resolveManagedAgentWallet } from "../../scripts/managedAgentWallet";

const LAMPORTS_PER_SOL = 1_000_000_000;
const DEMO_TRANSFER_SOL = 0.01;
const DEMO_TOKEN_DECIMALS = 6;
const DEMO_TOKEN_MINT_RAW = 10_000_000n;
const DEMO_TOKEN_DISTRIBUTION_RAW = 1_000_000n;
const TREASURY_MINIMUM_SOL = 0.5;

export async function runMultiAgentDevnetScenario(): Promise<{
  rpc: string;
  mintAddress: string;
  signatures: string[];
}> {
  const rpcClient = new RpcClient(getRpcUrl(), "confirmed");
  const transactionService = new TransactionService(rpcClient);
  const tokenService = new TokenService(rpcClient);
  const fundingService = new DevnetFundingService(rpcClient, transactionService);
  const runner = new AgentRunner();

  const treasuryManaged = resolveManagedAgentWallet({
    agentName: "multi-agent-treasury",
    ownerId: "multi-agent-devnet"
  });
  const treasuryWallet = treasuryManaged.walletManager;
  const treasuryBalanceService = new BalanceService(rpcClient, tokenService);
  await ensureManagedAgentWalletFunding({
    balanceService: treasuryBalanceService,
    fundingService,
    minimumSol: TREASURY_MINIMUM_SOL,
    publicKey: treasuryWallet.publicKey
  });

  const managedAgents = [
    resolveManagedAgentWallet({ agentName: "multi-agent-1", ownerId: "multi-agent-devnet" }),
    resolveManagedAgentWallet({ agentName: "multi-agent-2", ownerId: "multi-agent-devnet" }),
    resolveManagedAgentWallet({ agentName: "multi-agent-3", ownerId: "multi-agent-devnet" })
  ];
  const wallets = managedAgents.map((entry) => entry.walletManager);
  for (const wallet of wallets) {
    const transfer = await transactionService.buildTransaction({
      feePayer: treasuryWallet.publicKey,
      instructions: [
        transactionService.buildSolTransferInstructionInSol({
          from: treasuryWallet.publicKey,
          to: wallet.publicKey,
          amountSol: DEMO_TRANSFER_SOL
        })
      ],
      signer: treasuryWallet
    });
    await transactionService.sendAndConfirm(transfer);
  }

  const mintSetup = await tokenService.buildCreateMintInstructions({
    payer: treasuryWallet.publicKey,
    mintAuthority: treasuryWallet.publicKey,
    decimals: DEMO_TOKEN_DECIMALS
  });
  const mintBuild = await transactionService.buildTransaction({
    feePayer: treasuryWallet.publicKey,
    instructions: mintSetup.instructions,
    signer: treasuryWallet
  });
  mintBuild.transaction.sign([mintSetup.mintKeypair]);
  await transactionService.sendAndConfirm(mintBuild);

  const treasuryAta = await tokenService.ensureAtaInstruction({
    mint: mintSetup.mintKeypair.publicKey,
    owner: treasuryWallet.publicKey,
    payer: treasuryWallet.publicKey
  });
  const mintInstructions = [
    ...(treasuryAta.createInstruction ? [treasuryAta.createInstruction] : []),
    tokenService.buildMintToInstruction({
      mint: mintSetup.mintKeypair.publicKey,
      destinationAta: treasuryAta.address,
      authority: treasuryWallet.publicKey,
      amount: DEMO_TOKEN_MINT_RAW
    })
  ];
  const mintToTreasury = await transactionService.buildTransaction({
    feePayer: treasuryWallet.publicKey,
    instructions: mintInstructions,
    signer: treasuryWallet
  });
  await transactionService.sendAndConfirm(mintToTreasury);

  const recipients = wallets.map((wallet) => wallet.publicKey.toBase58());
  const treasuryContext = {
    id: treasuryManaged.agent.name,
    walletManager: treasuryWallet,
    walletPublicKey: treasuryWallet.publicKey,
    rpcClient,
    transactionService,
    tokenService,
    balanceService: treasuryBalanceService,
    policyConfig: createDefaultPolicyConfig({
      agentId: treasuryManaged.agent.name,
      allowedMints: [mintSetup.mintKeypair.publicKey.toBase58()],
      allowedTransferDestinations: recipients
    }),
    logger: (message: string) => console.log(`[${treasuryManaged.agent.name}] ${message}`)
  };

  const transferContext = wallets.map((wallet, index) => ({
    id: managedAgents[index].agent.name,
    walletManager: wallet,
    walletPublicKey: wallet.publicKey,
    rpcClient,
    transactionService,
    tokenService,
    balanceService: new BalanceService(rpcClient, tokenService),
    policyConfig: createDefaultPolicyConfig({
      agentId: managedAgents[index].agent.name,
      allowedMints: [mintSetup.mintKeypair.publicKey.toBase58()],
      allowedTransferDestinations: [
        treasuryWallet.publicKey.toBase58(),
        ...wallets.map((candidate) => candidate.publicKey.toBase58())
      ]
    }),
    logger: (message: string) => console.log(`[${managedAgents[index].agent.name}] ${message}`)
  }));

  runner.registerAgent({
    context: treasuryContext,
    strategy: new TreasuryDistributorStrategy({
      mint: mintSetup.mintKeypair.publicKey.toBase58(),
      recipients,
      amountRawPerRecipient: DEMO_TOKEN_DISTRIBUTION_RAW
    }),
    approvalMode: "sandbox"
  });

  runner.registerAgent({
    context: transferContext[0],
    strategy: new SimpleScriptedTransferStrategy({
      to: transferContext[1].walletPublicKey.toBase58(),
      lamports: Math.round(0.001 * LAMPORTS_PER_SOL),
      memo: "agent-1 scripted transfer"
    })
  });

  runner.registerAgent({
    context: transferContext[1],
    strategy: new MemoHeartbeatStrategy()
  });

  runner.registerAgent({
    context: transferContext[2],
    strategy: new SimpleScriptedTransferStrategy({
      to: treasuryWallet.publicKey.toBase58(),
      lamports: Math.round(0.0005 * LAMPORTS_PER_SOL),
      memo: "agent-3 return transfer"
    })
  });

  const runResults = await runner.runOnceParallel();
  const signatures = runResults.flatMap((result) =>
    result.outcomes.flatMap((outcome) => (outcome.signature ? [outcome.signature] : []))
  );

  for (const context of [treasuryContext, ...transferContext]) {
    const sol = await context.balanceService.getSolBalance(context.walletPublicKey);
    const spl = await context.balanceService.getSplTokenBalance({
      owner: context.walletPublicKey,
      mint: mintSetup.mintKeypair.publicKey
    });
    console.log(`${context.id} -> SOL: ${sol.toFixed(4)}, demo token: ${spl.toFixed(4)}`);
  }

  return {
    rpc: rpcClient.rpcUrl,
    mintAddress: mintSetup.mintKeypair.publicKey.toBase58(),
    signatures
  };
}
