import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";

type AnchorMode = "light-commitment" | "memo";

export type LocalPayloadRecord<T = unknown> = {
  address: string;
  anchorMode: AnchorMode;
  discriminatorHex: string;
  explorerUrl?: string;
  namespace: string;
  parts: string[];
  payload: T;
  signature: string;
  slot?: number;
  storedAt: number;
};

type LocalPayloadRegistryShape = {
  records: LocalPayloadRecord[];
};

const REGISTRY_PATH = path.join(process.cwd(), ".prkt-compressed-store.json");

function readRegistry(): LocalPayloadRegistryShape {
  if (!existsSync(REGISTRY_PATH)) {
    return { records: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as LocalPayloadRegistryShape;
    if (!parsed || !Array.isArray(parsed.records)) {
      return { records: [] };
    }
    return parsed;
  } catch {
    return { records: [] };
  }
}

function writeRegistry(registry: LocalPayloadRegistryShape): void {
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), "utf8");
}

export function upsertLocalPayloadRecord<T>(record: LocalPayloadRecord<T>): void {
  const registry = readRegistry();
  const existingIndex = registry.records.findIndex(
    (entry) =>
      entry.address === record.address &&
      entry.discriminatorHex === record.discriminatorHex &&
      entry.namespace === record.namespace
  );

  if (existingIndex >= 0) {
    registry.records[existingIndex] = record as LocalPayloadRecord;
  } else {
    registry.records.push(record as LocalPayloadRecord);
  }

  writeRegistry(registry);
}

export function findLocalPayloadRecord<T>(input: {
  discriminatorHex: string;
  namespace: string;
  parts: string[];
}): LocalPayloadRecord<T> | null {
  const registry = readRegistry();
  return (
    registry.records.find(
      (entry) =>
        entry.discriminatorHex === input.discriminatorHex &&
        entry.namespace === input.namespace &&
        entry.parts.length === input.parts.length &&
        entry.parts.every((value, index) => value === input.parts[index])
    ) as LocalPayloadRecord<T> | undefined
  ) ?? null;
}

export function listLocalPayloadRecords<T>(input: {
  discriminatorHex: string;
}): LocalPayloadRecord<T>[] {
  const registry = readRegistry();
  return registry.records.filter(
    (entry) => entry.discriminatorHex === input.discriminatorHex
  ) as LocalPayloadRecord<T>[];
}
