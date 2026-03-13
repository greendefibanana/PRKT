import chalk from "chalk";

import type { CliOutputOptions } from "../types";

function jsonReplacer(_: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export function printResult(output: CliOutputOptions, payload: unknown, title?: string): void {
  if (output.json) {
    console.log(JSON.stringify(payload, jsonReplacer, 2));
    return;
  }

  if (title) {
    console.log(chalk.cyan(title));
  }

  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      console.log(chalk.yellow("No records."));
      return;
    }
    console.table(payload as Record<string, unknown>[]);
    return;
  }

  if (typeof payload === "object" && payload !== null) {
    console.table([payload as Record<string, unknown>]);
    return;
  }

  console.log(payload);
}

export function txExplorer(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function addressExplorer(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

export function failWithMessage(error: unknown): never {
  if (error instanceof Error) {
    throw new Error(error.message);
  }
  throw new Error("Unknown CLI error");
}
