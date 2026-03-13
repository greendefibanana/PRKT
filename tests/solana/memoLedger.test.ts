import { ComputeBudgetProgram, Keypair, PublicKey } from "@solana/web3.js";

import {
  buildMemoTransaction,
  buildExplorerTxUrl,
  DEFAULT_MEMO_COMPUTE_UNIT_LIMIT,
  decodeMemoPayload,
  findMemoEntries,
  findMemoEntry
} from "../../src/solana/memoLedger";
import { MEMO_PROGRAM_ID } from "../../src/solana/programs";

function createParsedTransaction(input: {
  instructions?: Array<Record<string, unknown>>;
  logs?: string[];
  slot?: number;
}) {
  return {
    meta: {
      logMessages: input.logs ?? []
    },
    slot: input.slot ?? 42,
    transaction: {
      message: {
        instructions: input.instructions ?? []
      }
    }
  } as never;
}

describe("memoLedger", () => {
  it("decodes structured memo payloads from parsed instruction data", () => {
    const transaction = createParsedTransaction({
      instructions: [
        {
          parsed: {
            info: {
              memo: JSON.stringify({
                prkt: 1,
                event: "SESSION_START",
                sessionId: "session-1"
              })
            }
          },
          program: "spl-memo",
          programId: MEMO_PROGRAM_ID
        }
      ]
    });

    const payload = decodeMemoPayload<{ prkt: number; event: string; sessionId: string }>(
      transaction
    );

    expect(payload).toEqual({
      prkt: 1,
      event: "SESSION_START",
      sessionId: "session-1"
    });
  });

  it("falls back to memo log parsing when instruction payloads are unavailable", () => {
    const transaction = createParsedTransaction({
      logs: [
        `Program log: Memo: ${JSON.stringify(
          JSON.stringify({
            e: "PP",
            p: 1,
            t: "tx-1"
          })
        )}`
      ]
    });

    const payload = decodeMemoPayload<{ e: string; p: number; t: string }>(transaction);

    expect(payload).toEqual({
      e: "PP",
      p: 1,
      t: "tx-1"
    });
  });

  it("finds the first matching memo entry from confirmed transactions", async () => {
    const connection = {
      getParsedTransaction: jest
        .fn()
        .mockResolvedValueOnce(
          createParsedTransaction({
            instructions: [
              {
                parsed: {
                  memo: JSON.stringify({
                    agentId: "other-agent",
                    prkt: 1
                  })
                },
                program: "spl-memo",
                programId: new PublicKey(MEMO_PROGRAM_ID.toBase58())
              }
            ],
            slot: 100
          })
        )
        .mockResolvedValueOnce(
          createParsedTransaction({
            instructions: [
              {
                parsed: {
                  memo: JSON.stringify({
                    agentId: "agent-1",
                    prkt: 1
                  })
                },
                program: "spl-memo",
                programId: MEMO_PROGRAM_ID
              }
            ],
            slot: 101
          })
        ),
      getSignaturesForAddress: jest.fn(async () => [
        { signature: "sig-1" },
        { signature: "sig-2" }
      ])
    } as never;

    const result = await findMemoEntry({
      connection,
      isExpectedPayload: (value): value is { agentId: string; prkt: number } =>
        !!value &&
        typeof value === "object" &&
        typeof (value as { agentId?: unknown }).agentId === "string" &&
        (value as { prkt?: unknown }).prkt === 1,
      matches: (payload) => payload.agentId === "agent-1"
    });

    expect(result).toEqual({
      payload: {
        agentId: "agent-1",
        prkt: 1
      },
      signature: "sig-2",
      slot: 101
    });
  });

  it("collects multiple matching memo entries in signature order", async () => {
    const connection = {
      getParsedTransaction: jest
        .fn()
        .mockResolvedValueOnce(
          createParsedTransaction({
            instructions: [
              {
                parsed: {
                  memo: JSON.stringify({
                    agentId: "agent-1",
                    prkt: 1,
                    ts: 1
                  })
                },
                program: "spl-memo",
                programId: MEMO_PROGRAM_ID
              }
            ],
            slot: 201
          })
        )
        .mockResolvedValueOnce(
          createParsedTransaction({
            instructions: [
              {
                parsed: {
                  memo: JSON.stringify({
                    agentId: "agent-2",
                    prkt: 1,
                    ts: 2
                  })
                },
                program: "spl-memo",
                programId: MEMO_PROGRAM_ID
              }
            ],
            slot: 202
          })
        )
        .mockResolvedValueOnce(
          createParsedTransaction({
            instructions: [
              {
                parsed: {
                  memo: JSON.stringify({
                    agentId: "agent-1",
                    prkt: 1,
                    ts: 3
                  })
                },
                program: "spl-memo",
                programId: MEMO_PROGRAM_ID
              }
            ],
            slot: 203
          })
        ),
      getSignaturesForAddress: jest.fn(async () => [
        { signature: "sig-a" },
        { signature: "sig-b" },
        { signature: "sig-c" }
      ])
    } as never;

    const results = await findMemoEntries({
      connection,
      isExpectedPayload: (value): value is { agentId: string; prkt: number; ts: number } =>
        !!value &&
        typeof value === "object" &&
        typeof (value as { agentId?: unknown }).agentId === "string" &&
        (value as { prkt?: unknown }).prkt === 1 &&
        typeof (value as { ts?: unknown }).ts === "number",
      matches: (payload) => payload.agentId === "agent-1"
    });

    expect(results).toEqual([
      {
        payload: {
          agentId: "agent-1",
          prkt: 1,
          ts: 1
        },
        signature: "sig-a",
        slot: 201
      },
      {
        payload: {
          agentId: "agent-1",
          prkt: 1,
          ts: 3
        },
        signature: "sig-c",
        slot: 203
      }
    ]);
  });

  it("builds explorer URLs that match the detected cluster", () => {
    expect(buildExplorerTxUrl("sig", "https://api.devnet.solana.com")).toBe(
      "https://explorer.solana.com/tx/sig?cluster=devnet"
    );
    expect(buildExplorerTxUrl("sig", "https://api.mainnet-beta.solana.com")).toBe(
      "https://explorer.solana.com/tx/sig?cluster=mainnet-beta"
    );
    expect(buildExplorerTxUrl("sig", "http://127.0.0.1:8899")).toBe(
      "https://explorer.solana.com/tx/sig"
    );
  });

  it("adds a compute-budget instruction before large memo payloads", () => {
    const payer = Keypair.generate();
    const transaction = buildMemoTransaction({
      payload: {
        e: "PP",
        memo: "x".repeat(512)
      },
      payer
    });

    expect(transaction.instructions).toHaveLength(2);
    expect(transaction.instructions[0].programId.toBase58()).toBe(
      ComputeBudgetProgram.programId.toBase58()
    );
    expect(transaction.instructions[0].data).toEqual(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: DEFAULT_MEMO_COMPUTE_UNIT_LIMIT
      }).data
    );
    expect(transaction.instructions[1].programId.toBase58()).toBe(MEMO_PROGRAM_ID.toBase58());
    expect(transaction.feePayer?.toBase58()).toBe(payer.publicKey.toBase58());
  });
});
