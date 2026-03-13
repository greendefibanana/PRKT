import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import type { ActivityRecord } from "../types";
import { resolveCliDataPath } from "./storagePaths";

type ActivityFile = {
  activities: ActivityRecord[];
};

export class ActivityStore {
  append(record: ActivityRecord): void {
    const payload = this.read();
    payload.activities.push(record);
    this.write(payload);
  }

  list(limit = 100): ActivityRecord[] {
    const activities = this.read().activities;
    return activities.slice(Math.max(activities.length - limit, 0));
  }

  listByAgent(agent: string, limit = 100): ActivityRecord[] {
    return this.list(limit).filter((entry) => entry.agent === agent);
  }

  private read(): ActivityFile {
    const storePath = resolveCliDataPath("cli-activity.json");
    if (!existsSync(storePath)) {
      return {
        activities: []
      };
    }
    const raw = readFileSync(storePath, "utf8");
    const parsed = JSON.parse(raw) as ActivityFile;
    return {
      activities: parsed.activities ?? []
    };
  }

  private write(payload: ActivityFile): void {
    const storePath = resolveCliDataPath("cli-activity.json");
    mkdirSync(path.dirname(storePath), { recursive: true, mode: 0o700 });
    writeFileSync(storePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  }
}
