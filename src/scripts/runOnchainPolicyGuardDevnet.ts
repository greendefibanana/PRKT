import { Keypair } from "@solana/web3.js";

import { getRpcUrl } from "../config/env";
import { RpcClient } from "../core/rpc/RpcClient";
import { TransactionService } from "../core/transactions/TransactionService";
import { WalletManager } from "../core/wallet/WalletManager";
import {
  buildCloseSessionInstruction,
  buildInitializePolicyInstruction,
  buildManagedTransferInstructions,
  buildOpenSessionInstruction,
  createSessionId,
  findPolicyPda,
  findVaultPda,
  resolvePolicyGuardProgramId
} from "../onchain";

async function main(): Promise<void> {
  const rpcClient = new RpcClient(getRpcUrl(), "confirmed");
  const transactionService = new TransactionService(rpcClient);
  const treasuryWallet = WalletManager.loadOrGenerate();
  const treasurySigner = treasuryWallet.payer;
  const operatorSigner = Keypair.generate();
  const operatorWallet = WalletManager.fromSecretKey(operatorSigner.secretKey, "generated");
  const programId = resolvePolicyGuardProgramId();
  const amountLamports = 5_000_000n;
  const operatorFundingLamports = 50_000_000n;
  const sessionId = createSessionId(`prkt-onchain-${Date.now()}`);
  const recipient = Keypair.generate().publicKey;

  const operatorFundingInstruction = transactionService.buildSolTransferInstruction({
    from: treasurySigner.publicKey,
    to: operatorSigner.publicKey,
    lamports: Number(operatorFundingLamports)
  });
  const operatorFundingTx = await transactionService.buildTransaction({
    feePayer: treasurySigner.publicKey,
    instructions: [operatorFundingInstruction],
    signer: treasuryWallet
  });
  const operatorFundingResult = await transactionService.sendAndConfirm(operatorFundingTx);
  console.log(`operator funded: ${operatorFundingResult.signature}`);

  const { policyPda, vaultPda, instruction: initializePolicy } =
    buildInitializePolicyInstruction({
      owner: operatorSigner.publicKey,
      verifier: operatorSigner.publicKey,
      dailySpendLimitLamports: 25_000_000n,
      sessionTtlMinutes: 30,
      allowedPrograms: [programId],
      allowedRecipients: [recipient]
    });
  const policyAccount = await rpcClient.getAccountInfo(policyPda);

  if (!policyAccount) {
    const initializeTx = await transactionService.buildTransaction({
      feePayer: operatorSigner.publicKey,
      instructions: [initializePolicy],
      signer: operatorWallet
    });
    const initializeResult = await transactionService.sendAndConfirm(initializeTx);
    console.log(`policy initialized: ${initializeResult.signature}`);
  } else {
    console.log(`policy already exists: ${policyPda.toBase58()}`);
  }

  const fundInstruction = transactionService.buildSolTransferInstruction({
    from: operatorSigner.publicKey,
    to: vaultPda,
    lamports: Number(amountLamports * 2n)
  });
  const fundTx = await transactionService.buildTransaction({
    feePayer: operatorSigner.publicKey,
    instructions: [fundInstruction],
    signer: operatorWallet
  });
  const fundResult = await transactionService.sendAndConfirm(fundTx);
  console.log(`vault funded: ${fundResult.signature}`);

  const { sessionPda, instruction: openSession } = buildOpenSessionInstruction({
    owner: operatorSigner.publicKey,
    sessionId
  });
  const openTx = await transactionService.buildTransaction({
    feePayer: operatorSigner.publicKey,
    instructions: [openSession],
    signer: operatorWallet
  });
  const openResult = await transactionService.sendAndConfirm(openTx);
  console.log(`session opened: ${openResult.signature}`);

  const execute = buildManagedTransferInstructions({
    amountLamports,
    nonce: 0n,
    policyOwner: operatorSigner.publicKey,
    recipient,
    sessionId,
    signer: operatorSigner,
    expiresAtUnix: Math.floor(Date.now() / 1000) + 60
  });
  const executeTx = await transactionService.buildTransaction({
    feePayer: operatorSigner.publicKey,
    instructions: [execute.ed25519Instruction, execute.programInstruction],
    signer: operatorWallet
  });
  const executeResult = await transactionService.sendAndConfirm(executeTx);
  console.log(`managed transfer executed: ${executeResult.signature}`);
  console.log(`recipient: ${recipient.toBase58()}`);
  console.log(`policy: ${policyPda.toBase58()}`);
  console.log(`vault: ${vaultPda.toBase58()}`);
  console.log(`session: ${sessionPda.toBase58()}`);

  const { instruction: closeSession } = buildCloseSessionInstruction({
    owner: operatorSigner.publicKey,
    sessionId
  });
  const closeTx = await transactionService.buildTransaction({
    feePayer: operatorSigner.publicKey,
    instructions: [closeSession],
    signer: operatorWallet
  });
  const closeResult = await transactionService.sendAndConfirm(closeTx);
  console.log(`session closed: ${closeResult.signature}`);
}

main().catch((error) => {
  console.error("onchain policy-guard demo failed");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
