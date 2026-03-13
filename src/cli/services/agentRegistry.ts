import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import type { StoredAgentRecord } from "../types";
import { WalletRegistry } from "./walletRegistry";
import { resolveCliDataPath } from "./storagePaths";
import { DEFAULT_POLICY_PRESET } from "../../config/policyPresets";

type AgentRegistryFile = {
  agents: StoredAgentRecord[];
};

export class AgentRegistryStore {
  constructor(private readonly walletRegistry = new WalletRegistry()) {}

  list(): StoredAgentRecord[] {
    return this.read().agents.slice().sort((a, b) => a.name.localeCompare(b.name));
  }

  find(name: string): StoredAgentRecord | undefined {
    return this.read().agents.find((agent) => agent.name === name);
  }

  ensureForWallet(walletName: string): StoredAgentRecord {
    const existing = this.find(walletName);
    if (existing) {
      return existing;
    }

    const wallet = this.walletRegistry.find(walletName);
    if (!wallet) {
      throw new Error(`Cannot create agent for wallet '${walletName}': wallet not found.`);
    }

    const record: StoredAgentRecord = {
      createdAtIso: new Date().toISOString(),
      name: walletName,
      policyMode: "sandbox",
      policyPreset: DEFAULT_POLICY_PRESET,
      status: "active",
      strategy: "memo-heartbeat",
      walletName
    };
    this.upsert(record);
    return record;
  }

  createAgent(input: { agentId: string; ownerId?: string; walletName?: string }): StoredAgentRecord {
    const existing = this.find(input.agentId);
    if (existing) {
      throw new Error(`Agent '${input.agentId}' already exists.`);
    }

    const walletName = input.walletName ?? input.agentId;
    const wallet = this.walletRegistry.find(walletName);
    if (!wallet) {
      throw new Error(`Cannot create agent '${input.agentId}': wallet '${walletName}' not found.`);
    }

    const record: StoredAgentRecord = {
      createdAtIso: new Date().toISOString(),
      name: input.agentId,
      ownerId: input.ownerId,
      policyMode: "sandbox",
      policyPreset: DEFAULT_POLICY_PRESET,
      status: "active",
      strategy: "memo-heartbeat",
      walletName
    };
    this.upsert(record);
    return record;
  }

  upsert(record: StoredAgentRecord): StoredAgentRecord {
    const registry = this.read();
    const existingIndex = registry.agents.findIndex((agent) => agent.name === record.name);
    if (existingIndex >= 0) {
      registry.agents[existingIndex] = record;
    } else {
      registry.agents.push(record);
    }
    this.write(registry);
    return record;
  }

  patch(name: string, update: Partial<StoredAgentRecord>): StoredAgentRecord {
    const existing = this.find(name);
    if (!existing) {
      throw new Error(`Agent '${name}' not found.`);
    }
    return this.upsert({
      ...existing,
      ...update
    });
  }

  synchronizeWithWallets(): StoredAgentRecord[] {
    for (const wallet of this.walletRegistry.list()) {
      if (!this.find(wallet.name)) {
        this.ensureForWallet(wallet.name);
      }
    }

    return this.list();
  }

  private read(): AgentRegistryFile {
    const registryPath = resolveCliDataPath("cli-agents.json");
    if (!existsSync(registryPath)) {
      return {
        agents: []
      };
    }

    const raw = readFileSync(registryPath, "utf8");
    const parsed = JSON.parse(raw) as AgentRegistryFile;
    return {
      agents: (parsed.agents ?? []).map((agent) => this.normalize(agent))
    };
  }

  private write(payload: AgentRegistryFile): void {
    const registryPath = resolveCliDataPath("cli-agents.json");
    mkdirSync(path.dirname(registryPath), { recursive: true, mode: 0o700 });
    writeFileSync(registryPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  }

  private normalize(agent: StoredAgentRecord): StoredAgentRecord {
    return {
      ...agent,
      ownerId: agent.ownerId,
      policyPreset: agent.policyPreset ?? DEFAULT_POLICY_PRESET
    };
  }
}
