import { createHmac } from "crypto";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

import { getEmergencyLockStatus } from "../../src/policy/emergencyLock";

function signCommand(input: { enabled: boolean; issuedAtIso8601: string; reason?: string; secret: string }): string {
  const payload = `${input.enabled}:${input.issuedAtIso8601}:${input.reason ?? ""}`;
  return createHmac("sha256", input.secret).update(payload).digest("hex");
}

describe("emergencyLock signed command", () => {
  const originalEnv = { ...process.env };
  let sandboxDir = "";

  beforeEach(() => {
    process.env = { ...originalEnv };
    sandboxDir = mkdtempSync(path.join(tmpdir(), "sentinel-lock-"));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (sandboxDir) {
      rmSync(sandboxDir, { force: true, recursive: true });
    }
  });

  it("locks when signed command is valid and enabled", () => {
    const commandPath = path.join(sandboxDir, "emergency_command.json");
    const secret = "local-test-secret";
    const issuedAtIso8601 = new Date().toISOString();
    const reason = "manual emergency stop";
    const signature = signCommand({
      enabled: true,
      issuedAtIso8601,
      reason,
      secret
    });

    writeFileSync(
      commandPath,
      JSON.stringify({
        enabled: true,
        issuedAtIso8601,
        reason,
        signature
      }),
      "utf8"
    );

    process.env.POLICY_EMERGENCY_COMMAND_PATH = commandPath;
    process.env.POLICY_EMERGENCY_ADMIN_SECRET = secret;

    const status = getEmergencyLockStatus();
    expect(status.locked).toBe(true);
    expect(status.reason).toContain("manual emergency stop");
  });

  it("fails closed when command signature is invalid", () => {
    const commandPath = path.join(sandboxDir, "emergency_command.json");
    writeFileSync(
      commandPath,
      JSON.stringify({
        enabled: true,
        issuedAtIso8601: new Date().toISOString(),
        reason: "tampered",
        signature: "deadbeef"
      }),
      "utf8"
    );

    process.env.POLICY_EMERGENCY_COMMAND_PATH = commandPath;
    process.env.POLICY_EMERGENCY_ADMIN_SECRET = "local-test-secret";

    const status = getEmergencyLockStatus();
    expect(status.locked).toBe(true);
    expect(status.reason).toContain("signature verification failed");
  });
});

