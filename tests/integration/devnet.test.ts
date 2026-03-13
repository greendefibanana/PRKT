import { BN } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction
} from "@solana/web3.js";

import { SessionAnchor } from "../../src/anchoring/SessionAnchor";
import { AuditLogManager } from "../../src/compression/AuditLogManager";
import { PolicyAccountManager } from "../../src/compression/PolicyAccountManager";
import { defaultPRKTConfig } from "../../src/config/PRKTConfig";
import {
  detectClusterFromRpcUrl,
  getOptionalDevnetTreasurySecretKey,
  getRpcUrl
} from "../../src/config/env";
import { RpcClient } from "../../src/core/rpc/RpcClient";
import { TransactionService } from "../../src/core/transactions/TransactionService";
import { WalletManager } from "../../src/core/wallet/WalletManager";
import { NeonWalletBridge } from "../../src/evm/NeonWalletBridge";
import { PolicyEngine } from "../../src/policy";
import { SandboxExecutor } from "../../src/policy/sandbox/SandboxExecutor";
import { ProofAnchor } from "../../src/zk/ProofAnchor";

const DEVNET_NEON_USDC = "0x512E48836Cd42F3eB6f50CEd9ffD81E0a7F15103";
const DEVNET_NEON_WSOL = "0xc7Fc9b46e479c5Cb42f6C458D1881e55E6B7986c";
const DEVNET_RPC = getRpcUrl();
const describeDevnet = process.env.PRKT_RUN_DEVNET_TESTS === "1" ? describe : describe.skip;

describeDevnet("Devnet integration @devnet", () => {
  jest.setTimeout(300_000);

  const originalConfig = JSON.parse(JSON.stringify(defaultPRKTConfig)) as typeof defaultPRKTConfig;

  afterAll(() => {
    defaultPRKTConfig.dataAnchoring.enabled = originalConfig.dataAnchoring.enabled;
    defaultPRKTConfig.evmAdapters.enabled = originalConfig.evmAdapters.enabled;
    defaultPRKTConfig.evmAdapters.neonRpcEndpoint = originalConfig.evmAdapters.neonRpcEndpoint;
    defaultPRKTConfig.zkCompression.enabled = originalConfig.zkCompression.enabled;
    defaultPRKTConfig.zkCompression.rpcEndpoint = originalConfig.zkCompression.rpcEndpoint;
    defaultPRKTConfig.zkPolicyProofs.enabled = originalConfig.zkPolicyProofs.enabled;
  });

  it("runs a full agent session on Solana devnet without mocks", async () => {
    expect(detectClusterFromRpcUrl(DEVNET_RPC)).toBe("devnet");

    defaultPRKTConfig.dataAnchoring.enabled = true;
    defaultPRKTConfig.evmAdapters.enabled = true;
    defaultPRKTConfig.evmAdapters.neonRpcEndpoint = "https://devnet.neonevm.org";
    defaultPRKTConfig.zkCompression.enabled = true;
    defaultPRKTConfig.zkCompression.rpcEndpoint = DEVNET_RPC;
    defaultPRKTConfig.zkPolicyProofs.enabled = true;

    const connection = new Connection(DEVNET_RPC, "confirmed");
    const agentKeypair = Keypair.generate();
    const walletManager = WalletManager.fromSecretKey(agentKeypair.secretKey, "generated");
    const agentId = `devnet-agent-${Date.now()}`;
    const firstRecipient = Keypair.generate().publicKey;
    const secondRecipient = Keypair.generate().publicKey;

    await fundWallet(connection, agentKeypair.publicKey, 1.6);
    const solanaAllowedPrograms = [SystemProgram.programId.toBase58()];
    const allowedPrograms = [...solanaAllowedPrograms, DEVNET_NEON_WSOL.toLowerCase()];

    const policyManager = new PolicyAccountManager(DEVNET_RPC);
    const policyCreateSignature = await policyManager.createCompressedPolicyAccount(agentId, {
      dailySpendLimit: new BN(2_000_000_000),
      sessionTTL: 60,
      programAllowlist: solanaAllowedPrograms
        .map((programId) => new PublicKey(programId)),
      killSwitchActive: false,
      spentToday: new BN(0),
      lastResetTimestamp: Date.now()
    }, agentKeypair);
    expect(policyCreateSignature).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);

    const compressedPolicy = await policyManager.fetchCompressedPolicyAccount(agentId);
    expect(compressedPolicy.dailySpendLimit.toString()).toBe("2000000000");

    const policyEngine = new PolicyEngine({
      agentId,
      approvalMode: "sandbox",
      limits: {
        maxSolPerTxLamports: 2_000_000_000,
        maxSplPerTxRawAmount: 10_000_000_000_000n,
        maxTransactionsPerDay: 20,
        maxTransactionsPerSession: 20
      },
      rules: {
        allowOpaqueProgramIds: allowedPrograms,
        allowedMintAddresses: [],
        allowedProgramIds: allowedPrograms,
        denyUnknownInstructionsByDefault: true,
        rejectSuspiciousBalanceDeltas: true,
        requireSimulationSuccess: true
      },
      sessionExpiresAtIso8601: new Date(Date.now() + compressedPolicy.sessionTTL * 60_000).toISOString()
    });
    const rpcClient = new RpcClient(DEVNET_RPC, "confirmed");
    const transactionService = new TransactionService(rpcClient);
    const sandboxExecutor = new SandboxExecutor(policyEngine, transactionService, "sandbox");
    const sessionAnchor = new SessionAnchor(DEVNET_RPC, walletManager);
    const auditLogManager = new AuditLogManager(DEVNET_RPC);
    const proofAnchor = new ProofAnchor(DEVNET_RPC, walletManager);

    const sessionStart = await sessionAnchor.startSession(agentId);
    expect(sessionStart.slot).toBeGreaterThan(0);

    const firstTransfer = await sandboxExecutor.executePreparedTransaction({
      solanaKeypair: agentKeypair,
      transaction: await buildTransferTransaction({
        amountLamports: Math.round(0.1 * LAMPORTS_PER_SOL),
        connection,
        from: agentKeypair,
        to: firstRecipient
      })
    });
    expect(firstTransfer.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(firstTransfer.zkProof?.publicKey).toBe(agentKeypair.publicKey.toBase58());

    const firstRecipientBalance = await connection.getBalance(firstRecipient, "confirmed");
    expect(firstRecipientBalance).toBeGreaterThanOrEqual(Math.round(0.1 * LAMPORTS_PER_SOL));

    const auditAfterFirstTransfer = await auditLogManager.fetchAuditLog(agentId);
    expect(auditAfterFirstTransfer.some((entry) => entry.txSignature === firstTransfer.signature)).toBe(true);

    const secondTransfer = await sandboxExecutor.executePreparedTransaction({
      solanaKeypair: agentKeypair,
      transaction: await buildTransferTransaction({
        amountLamports: Math.round(1.0 * LAMPORTS_PER_SOL),
        connection,
        from: agentKeypair,
        to: secondRecipient
      })
    });
    expect(secondTransfer.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    const secondRecipientBalance = await connection.getBalance(secondRecipient, "confirmed");
    expect(secondRecipientBalance).toBeGreaterThanOrEqual(1_000_000_000);

    const bridge = new NeonWalletBridge(defaultPRKTConfig.evmAdapters.neonRpcEndpoint);
    const evmAddress = await bridge.deriveEvmAddress(agentKeypair);
    const rejectedEvmAttempt = await sandboxExecutor.executePreparedEvmTransaction({
      address: evmAddress,
      solanaKeypair: agentKeypair,
      transaction: {
        data: "0x095ea7b3",
        from: evmAddress,
        to: DEVNET_NEON_WSOL,
        value: 950_000_000n
      }
    });
    expect(rejectedEvmAttempt.allowed).toBe(false);
    expect(rejectedEvmAttempt.reason).toBe("DAILY_LIMIT_EXCEEDED");

    const auditLog = await auditLogManager.fetchAuditLog(agentId);
    const close = await sessionAnchor.closeSession(sessionStart.sessionId, auditLog);
    expect(close.closeSignature).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(close.ledgerSlot).toBeGreaterThan(0);

    const sessionVerification = await sessionAnchor.verifySession(sessionStart.sessionId, close.commitment);
    expect(sessionVerification.valid).toBe(true);

    const proofVerification = await proofAnchor.verifyProof(firstTransfer.signature!);
    expect(proofVerification.valid).toBe(true);
    expect(proofVerification.checks?.allowlist.passed).toBe(true);
    expect(proofVerification.checks?.killSwitch.passed).toBe(true);
    expect(proofVerification.checks?.spendLimit.passed).toBe(true);
    expect(proofVerification.checks?.ttl.passed).toBe(true);

    console.log(`Session ID: ${sessionStart.sessionId}`);
    console.log(`Anchor tx: ${close.explorerUrl}`);
    console.log(`Policy proof: ${proofVerification.explorerUrl}`);
    console.log(`Total spent: ${policyEngine.getSpentToday().toFixed(3)} SOL / 2 SOL limit`);
    console.log(`Rejected txs: ${auditLog.filter((entry) => !entry.approved).length} (DAILY_LIMIT_EXCEEDED)`);
    console.log("All 9 assertions: PASSED");
  });
});

async function buildTransferTransaction(input: {
  amountLamports: number;
  connection: Connection;
  from: Keypair;
  to: PublicKey;
}): Promise<VersionedTransaction> {
  const latestBlockhash = await input.connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    instructions: [
      SystemProgram.transfer({
        fromPubkey: input.from.publicKey,
        lamports: input.amountLamports,
        toPubkey: input.to
      })
    ],
    payerKey: input.from.publicKey,
    recentBlockhash: latestBlockhash.blockhash
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([input.from]);
  return transaction;
}

async function fundWallet(connection: Connection, publicKey: PublicKey, amountSol: number): Promise<void> {
  const targetLamports = Math.round(amountSol * LAMPORTS_PER_SOL);
  let fundedLamports = 0;
  const treasurySecretKey = getOptionalDevnetTreasurySecretKey();
  if (treasurySecretKey) {
    const treasury = Keypair.fromSecretKey(treasurySecretKey);
    const treasuryBalance = await connection.getBalance(treasury.publicKey, "confirmed");
    const treasuryTransferLamports = Math.max(0, Math.min(
      targetLamports,
      treasuryBalance - Math.round(0.05 * LAMPORTS_PER_SOL)
    ));

    if (treasuryTransferLamports > 0) {
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: treasury.publicKey,
          lamports: treasuryTransferLamports,
          toPubkey: publicKey
        })
      );
      await sendAndConfirmTransaction(connection, transaction, [treasury], {
        commitment: "confirmed"
      });
      fundedLamports += treasuryTransferLamports;
    }
  }

  let lastError: unknown;
  let remainingLamports = targetLamports - fundedLamports;

  while (remainingLamports > 0) {
    const requestLamports = Math.min(remainingLamports, LAMPORTS_PER_SOL);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const signature = await connection.requestAirdrop(publicKey, requestLamports);
        await connection.confirmTransaction(signature, "confirmed");
        remainingLamports -= requestLamports;
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
    }

    if (lastError) {
      break;
    }
  }

  if (remainingLamports <= 0) {
    return;
  }

  throw lastError instanceof Error ? lastError : new Error("devnet airdrop failed");
}
