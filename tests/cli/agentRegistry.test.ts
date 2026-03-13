import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import os from "os";

import { AgentRegistryStore } from "../../src/cli/services/agentRegistry";
import { getCliHomeEnvName } from "../../src/cli/services/storagePaths";
import { WalletRegistry } from "../../src/cli/services/walletRegistry";

const CLI_HOME_ENV = getCliHomeEnvName();
const ARTIFACTS_DIR = path.join(os.tmpdir(), "prkt-agent-registry-tests");
const AGENT_REGISTRY_PATH = path.resolve(ARTIFACTS_DIR, "cli-agents.json");
const WALLET_REGISTRY_PATH = path.resolve(ARTIFACTS_DIR, "cli-wallets.json");

describe("AgentRegistryStore", () => {
  beforeEach(() => {
    process.env[CLI_HOME_ENV] = ARTIFACTS_DIR;
    rmSync(ARTIFACTS_DIR, { force: true, recursive: true });
    mkdirSync(ARTIFACTS_DIR, { recursive: true });
    writeFileSync(AGENT_REGISTRY_PATH, JSON.stringify({ agents: [] }, null, 2));
    writeFileSync(WALLET_REGISTRY_PATH, JSON.stringify({ wallets: [] }, null, 2));
  });

  afterAll(() => {
    delete process.env[CLI_HOME_ENV];
    if (existsSync(AGENT_REGISTRY_PATH)) {
      rmSync(AGENT_REGISTRY_PATH, { force: true });
    }
    if (existsSync(WALLET_REGISTRY_PATH)) {
      rmSync(WALLET_REGISTRY_PATH, { force: true });
    }
    if (existsSync(ARTIFACTS_DIR)) {
      rmSync(ARTIFACTS_DIR, { force: true, recursive: true });
    }
  });

  it("attaches the default policy preset when creating an agent for a wallet", () => {
    const walletRegistry = new WalletRegistry();
    walletRegistry.create("provider-wallet");

    const registry = new AgentRegistryStore(walletRegistry);
    const agent = registry.ensureForWallet("provider-wallet");

    expect(agent.policyPreset).toBe("auto-devnet-safe");
    expect(agent.policyMode).toBe("sandbox");
  });

  it("normalizes legacy records without a policy preset", () => {
    const walletRegistry = new WalletRegistry();
    walletRegistry.create("legacy-wallet");
    writeFileSync(
      AGENT_REGISTRY_PATH,
      JSON.stringify(
        {
          agents: [
            {
              createdAtIso: new Date().toISOString(),
              name: "legacy-wallet",
              policyMode: "sandbox",
              status: "active",
              strategy: "memo-heartbeat",
              walletName: "legacy-wallet"
            }
          ]
        },
        null,
        2
      )
    );

    const registry = new AgentRegistryStore(walletRegistry);
    const [agent] = registry.list();

    expect(agent.policyPreset).toBe("auto-devnet-safe");
  });
});
