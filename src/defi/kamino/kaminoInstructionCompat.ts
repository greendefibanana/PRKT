import { AccountRole, type Instruction as KitInstruction } from "@solana/kit";
import { PublicKey, TransactionInstruction, type AccountMeta } from "@solana/web3.js";

export function convertKaminoInstruction(instruction: KitInstruction): TransactionInstruction {
  return new TransactionInstruction({
    data: Buffer.from(instruction.data ?? new Uint8Array()),
    keys: (instruction.accounts ?? []).map((account) => convertAccount(account)),
    programId: new PublicKey(instruction.programAddress)
  });
}

function convertAccount(account: {
  address: string;
  lookupTableAddress?: string;
  role: AccountRole;
}): AccountMeta {
  if ("lookupTableAddress" in account && account.lookupTableAddress) {
    throw new Error(
      `Kamino instruction references lookup table ${account.lookupTableAddress}; lookup-table-backed Kamino transactions are not supported by this live path yet.`
    );
  }

  return {
    isSigner:
      account.role === AccountRole.READONLY_SIGNER ||
      account.role === AccountRole.WRITABLE_SIGNER,
    isWritable:
      account.role === AccountRole.WRITABLE ||
      account.role === AccountRole.WRITABLE_SIGNER,
    pubkey: new PublicKey(account.address)
  };
}
