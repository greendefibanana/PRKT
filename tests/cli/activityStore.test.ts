import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import os from "os";

import { ActivityStore } from "../../src/cli/services/activityStore";
import { getCliHomeEnvName } from "../../src/cli/services/storagePaths";

const CLI_HOME_ENV = getCliHomeEnvName();
const ARTIFACTS_DIR = path.join(os.tmpdir(), "prkt-activity-store-tests");
const ACTIVITY_PATH = path.resolve(ARTIFACTS_DIR, "cli-activity.json");

describe("ActivityStore", () => {
  beforeEach(() => {
    process.env[CLI_HOME_ENV] = ARTIFACTS_DIR;
    rmSync(ARTIFACTS_DIR, { force: true, recursive: true });
    mkdirSync(ARTIFACTS_DIR, { recursive: true });
    writeFileSync(ACTIVITY_PATH, JSON.stringify({ activities: [] }, null, 2));
  });

  afterAll(() => {
    delete process.env[CLI_HOME_ENV];
    if (existsSync(ACTIVITY_PATH)) {
      rmSync(ACTIVITY_PATH, { force: true });
    }
    if (existsSync(ARTIFACTS_DIR)) {
      rmSync(ARTIFACTS_DIR, { force: true, recursive: true });
    }
  });

  it("appends and reads activity entries", () => {
    const store = new ActivityStore();
    store.append({
      createdAtIso: new Date().toISOString(),
      details: { action: "test" },
      kind: "monitor"
    });

    const logs = store.list(10);
    expect(logs.length).toBe(1);
    expect(logs[0].kind).toBe("monitor");
  });

  it("filters entries by agent", () => {
    const store = new ActivityStore();
    store.append({
      agent: "agent-a",
      createdAtIso: new Date().toISOString(),
      details: { action: "run" },
      kind: "agent"
    });
    store.append({
      agent: "agent-b",
      createdAtIso: new Date().toISOString(),
      details: { action: "run" },
      kind: "agent"
    });

    const filtered = store.listByAgent("agent-a");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].agent).toBe("agent-a");
  });
});
