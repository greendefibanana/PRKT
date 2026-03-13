import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction
} from "@solana/web3.js";

import { PolicyGuard } from "../policy/PolicyGuard";
import { WalletManager } from "../wallet/WalletManager";
import { MOCK_BLOCKHASH } from "../solana/programs";

export function createCompromisedDrainTransaction(walletManager: WalletManager): {
  recipient: string;
  transaction: VersionedTransaction;
} {
  const attackerDestination = Keypair.generate().publicKey;
  const instruction = SystemProgram.transfer({
    fromPubkey: walletManager.publicKey,
    toPubkey: attackerDestination,
    lamports: 1_000_000
  });

  const message = new TransactionMessage({
    payerKey: walletManager.publicKey,
    recentBlockhash: MOCK_BLOCKHASH,
    instructions: [instruction]
  }).compileToV0Message();

  const transaction = new VersionedTransaction(message);
  transaction.sign([walletManager.payer]);

  return {
    recipient: attackerDestination.toBase58(),
    transaction
  };
}

export function simulateAttack(policyGuard: PolicyGuard, walletManager: WalletManager): string {
  const { recipient, transaction } = createCompromisedDrainTransaction(walletManager);
  policyGuard.validate(transaction);
  return recipient;
}
