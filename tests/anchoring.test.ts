import { Connection, Keypair, LAMPORTS_PER_SOL, sendAndConfirmTransaction, SystemProgram, Transaction } from "@solana/web3.js";

import { SessionAnchor } from "../src/anchoring/SessionAnchor";
import { getOptionalDevnetTreasurySecretKey } from "../src/config/env";
import { WalletManager } from "../src/core/wallet/WalletManager";

const describeDevnet = process.env.PRKT_RUN_DEVNET_TESTS === "1" ? describe : describe.skip;

describeDevnet("Memo session anchor", () => {
  jest.setTimeout(30_000);

  it("starts a session, closes it, and verifies the anchored commitment", async () => {
    const rpcEndpoint = "https://api.devnet.solana.com";
    const connection = new Connection(rpcEndpoint, "confirmed");
    const keypair = Keypair.generate();
    const wallet = WalletManager.fromSecretKey(keypair.secretKey, "generated");
    const anchor = new SessionAnchor(rpcEndpoint, wallet);
    await fundWallet(connection, keypair.publicKey);

    const start = await anchor.startSession("agent-123");
    expect(start.sessionId).toEqual(expect.any(String));
    expect(start.slot).toBeGreaterThan(0);

    const close = await anchor.closeSession(start.sessionId, []);
    expect(close.commitment).toEqual(expect.any(String));
    expect(close.ledgerSlot).toBeGreaterThan(0);

    const verification = await anchor.verifySession(start.sessionId, close.commitment);
    expect(verification.valid).toBe(true);
  });
});

async function fundWallet(connection: Connection, publicKey: Keypair["publicKey"]): Promise<void> {
  const treasurySecretKey = getOptionalDevnetTreasurySecretKey();
  if (treasurySecretKey) {
    const treasury = Keypair.fromSecretKey(treasurySecretKey);
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: treasury.publicKey,
        lamports: LAMPORTS_PER_SOL / 10,
        toPubkey: publicKey
      })
    );
    await sendAndConfirmTransaction(connection, transaction, [treasury], {
      commitment: "confirmed"
    });
    return;
  }

  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const signature = await connection.requestAirdrop(publicKey, LAMPORTS_PER_SOL / 10);
      await connection.confirmTransaction(signature, "confirmed");
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("devnet airdrop failed");
}
