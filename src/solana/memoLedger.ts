import {
  ComputeBudgetProgram,
  type Connection,
  type Keypair,
  type ParsedInstruction,
  type ParsedTransactionWithMeta,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction
} from "@solana/web3.js";

import { detectClusterFromRpcUrl } from "../config/env";
import { AnchorError } from "../errors/PRKTError";
import { MEMO_PROGRAM_ID } from "./programs";

export const DEFAULT_MEMO_COMPUTE_UNIT_LIMIT = 1_000_000;

type MemoCandidate = {
  payload: string;
  source: "instruction" | "log";
};

export type MemoSearchResult<T> = {
  payload: T;
  signature: string;
  slot: number;
};

export function buildExplorerTxUrl(signature: string, rpcEndpoint: string): string {
  const cluster = detectClusterFromRpcUrl(rpcEndpoint);
  if (cluster === "devnet" || cluster === "testnet" || cluster === "mainnet-beta") {
    return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
  }

  return `https://explorer.solana.com/tx/${signature}`;
}

export function decodeMemoPayload<T>(
  transaction: ParsedTransactionWithMeta,
  isExpectedPayload?: (value: unknown) => value is T
): T | null {
  const candidates = [
    ...extractInstructionMemoCandidates(transaction),
    ...extractLogMemoCandidates(transaction)
  ];

  for (const candidate of candidates) {
    const parsed = tryParsePayload(candidate.payload);
    if (parsed === null) {
      continue;
    }

    if (!isExpectedPayload || isExpectedPayload(parsed)) {
      return parsed as T;
    }
  }

  return null;
}

export async function findMemoEntry<T>(input: {
  connection: Connection;
  isExpectedPayload?: (value: unknown) => value is T;
  limit?: number;
  matches: (payload: T) => boolean;
}): Promise<MemoSearchResult<T> | null> {
  const signatures = await input.connection.getSignaturesForAddress(
    MEMO_PROGRAM_ID,
    {
      limit: input.limit ?? 200
    },
    "confirmed"
  );

  for (const entry of signatures) {
    const transaction = await input.connection.getParsedTransaction(entry.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    });
    if (!transaction) {
      continue;
    }

    const payload = decodeMemoPayload(transaction, input.isExpectedPayload);
    if (!payload || !input.matches(payload)) {
      continue;
    }

    return {
      payload,
      signature: entry.signature,
      slot: transaction.slot
    };
  }

  return null;
}

export async function findMemoEntries<T>(input: {
  connection: Connection;
  isExpectedPayload?: (value: unknown) => value is T;
  limit?: number;
  matches: (payload: T) => boolean;
}): Promise<MemoSearchResult<T>[]> {
  const signatures = await input.connection.getSignaturesForAddress(
    MEMO_PROGRAM_ID,
    {
      limit: input.limit ?? 200
    },
    "confirmed"
  );
  const matches: MemoSearchResult<T>[] = [];

  for (const entry of signatures) {
    const transaction = await input.connection.getParsedTransaction(entry.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    });
    if (!transaction) {
      continue;
    }

    const payload = decodeMemoPayload(transaction, input.isExpectedPayload);
    if (!payload || !input.matches(payload)) {
      continue;
    }

    matches.push({
      payload,
      signature: entry.signature,
      slot: transaction.slot
    });
  }

  return matches;
}

export async function sendMemoPayload<T>(input: {
  connection: Connection;
  payload: T;
  payer: Keypair;
}): Promise<{ signature: string; slot: number }> {
  const transaction = buildMemoTransaction({
    payload: input.payload,
    payer: input.payer
  });

  const signature = await sendAndConfirmTransaction(
    input.connection,
    transaction,
    [input.payer],
    {
      commitment: "confirmed"
    }
  );

  const confirmed = await input.connection.getParsedTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0
  });
  if (!confirmed) {
    throw new AnchorError(`Unable to fetch confirmed memo transaction ${signature}`);
  }

  return {
    signature,
    slot: confirmed.slot
  };
}

export function buildMemoTransaction<T>(input: {
  payload: T;
  payer: Keypair;
}): Transaction {
  const transaction = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: DEFAULT_MEMO_COMPUTE_UNIT_LIMIT
    }),
    new TransactionInstruction({
      data: Buffer.from(JSON.stringify(input.payload), "utf8"),
      keys: [],
      programId: MEMO_PROGRAM_ID
    })
  );
  transaction.feePayer = input.payer.publicKey;
  return transaction;
}

function extractInstructionMemoCandidates(transaction: ParsedTransactionWithMeta): MemoCandidate[] {
  const instructions = transaction.transaction.message.instructions ?? [];
  const candidates: MemoCandidate[] = [];

  for (const instruction of instructions) {
    if (!instructionProgramMatchesMemo(instruction)) {
      continue;
    }

    const payload = extractInstructionPayload(instruction);
    if (!payload) {
      continue;
    }

    candidates.push({
      payload,
      source: "instruction"
    });
  }

  return candidates;
}

function instructionProgramMatchesMemo(instruction: ParsedInstruction | Record<string, unknown>): boolean {
  const program = typeof (instruction as { program?: unknown }).program === "string"
    ? (instruction as { program: string }).program
    : null;
  if (program === "spl-memo") {
    return true;
  }

  const programId = (instruction as { programId?: { toBase58?: () => string } }).programId;
  return typeof programId?.toBase58 === "function" && programId.toBase58() === MEMO_PROGRAM_ID.toBase58();
}

function extractInstructionPayload(instruction: ParsedInstruction | Record<string, unknown>): string | null {
  const parsed = (instruction as { parsed?: unknown }).parsed;
  if (typeof parsed === "string") {
    return parsed;
  }

  if (parsed && typeof parsed === "object") {
    const parsedRecord = parsed as Record<string, unknown>;
    if (typeof parsedRecord.memo === "string") {
      return parsedRecord.memo;
    }
    const infoMemo = parsedRecord.info;
    if (infoMemo && typeof infoMemo === "object" && typeof (infoMemo as { memo?: unknown }).memo === "string") {
      return (infoMemo as { memo: string }).memo;
    }
  }

  const rawData = (instruction as { data?: unknown }).data;
  if (typeof rawData === "string") {
    return rawData;
  }

  return null;
}

function extractLogMemoCandidates(transaction: ParsedTransactionWithMeta): MemoCandidate[] {
  const logs = transaction.meta?.logMessages ?? [];
  const candidates: MemoCandidate[] = [];

  for (const log of logs) {
    const payloadMatch = log.match(/Program log: Memo(?: [^:]+)?: (.+)$/u);
    if (!payloadMatch) {
      continue;
    }

    candidates.push({
      payload: payloadMatch[1],
      source: "log"
    });
  }

  return candidates;
}

function tryParsePayload(raw: string): unknown | null {
  const attempts: string[] = [];

  try {
    const first = JSON.parse(raw) as unknown;
    if (typeof first === "string") {
      attempts.push(first);
    } else {
      return first;
    }
  } catch {
    attempts.push(raw);
  }

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt) as unknown;
    } catch {
      // Ignore and continue.
    }
  }

  return null;
}
