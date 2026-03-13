import { createHmac, timingSafeEqual } from "crypto";
import { existsSync, readFileSync } from "fs";
import path from "path";

const EMERGENCY_FLAG_ENV = "POLICY_EMERGENCY_LOCK";
const EMERGENCY_LOCK_PATH_ENV = "POLICY_EMERGENCY_LOCK_PATH";
const EMERGENCY_COMMAND_PATH_ENV = "POLICY_EMERGENCY_COMMAND_PATH";
const EMERGENCY_COMMAND_SECRET_ENV = "POLICY_EMERGENCY_ADMIN_SECRET";
const EMERGENCY_COMMAND_MAX_AGE_SECONDS_ENV = "POLICY_EMERGENCY_MAX_AGE_SECONDS";

const DEFAULT_EMERGENCY_LOCK_PATH = path.join(process.cwd(), "emergency_lock.json");
const DEFAULT_EMERGENCY_COMMAND_PATH = path.join(process.cwd(), "emergency_command.json");

type EmergencyLockConfig = {
  enabled?: boolean;
  locked?: boolean;
  reason?: string;
};

type SignedEmergencyCommand = {
  enabled: boolean;
  issuedAtIso8601: string;
  reason?: string;
  signature: string;
};

export function getEmergencyLockStatus(): { locked: boolean; reason: string | null } {
  const flag = process.env[EMERGENCY_FLAG_ENV]?.trim().toLowerCase();
  if (flag === "true" || flag === "1") {
    return {
      locked: true,
      reason: `Human-in-the-loop Override engaged via ${EMERGENCY_FLAG_ENV}.`
    };
  }

  const signedCommandStatus = getSignedEmergencyCommandStatus();
  if (signedCommandStatus.locked) {
    return signedCommandStatus;
  }

  const emergencyLockPath = getEmergencyLockPath();
  if (!existsSync(emergencyLockPath)) {
    return {
      locked: false,
      reason: null
    };
  }

  try {
    const raw = readFileSync(emergencyLockPath, "utf8").trim();
    if (raw.length === 0) {
      return {
        locked: true,
        reason: `Human-in-the-loop Override engaged via ${path.basename(emergencyLockPath)}.`
      };
    }

    const parsed = JSON.parse(raw) as EmergencyLockConfig;
    const enabled = parsed.enabled ?? parsed.locked ?? false;
    if (enabled) {
      return {
        locked: true,
        reason:
          parsed.reason?.trim() ||
          `Human-in-the-loop Override engaged via ${path.basename(emergencyLockPath)}.`
      };
    }

    return {
      locked: false,
      reason: null
    };
  } catch {
    return {
      locked: true,
      reason: `Human-in-the-loop Override engaged because ${path.basename(emergencyLockPath)} is invalid.`
    };
  }
}

function getEmergencyLockPath(): string {
  const override = process.env[EMERGENCY_LOCK_PATH_ENV]?.trim();
  if (!override) {
    return DEFAULT_EMERGENCY_LOCK_PATH;
  }

  return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
}

function getEmergencyCommandPath(): string {
  const override = process.env[EMERGENCY_COMMAND_PATH_ENV]?.trim();
  if (!override) {
    return DEFAULT_EMERGENCY_COMMAND_PATH;
  }

  return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
}

function getEmergencyCommandMaxAgeMs(): number {
  const raw = process.env[EMERGENCY_COMMAND_MAX_AGE_SECONDS_ENV]?.trim();
  if (!raw) {
    return 10 * 60 * 1000;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 10 * 60 * 1000;
  }

  return parsed * 1000;
}

function getSignedEmergencyCommandStatus(): { locked: boolean; reason: string | null } {
  const commandPath = getEmergencyCommandPath();
  if (!existsSync(commandPath)) {
    return {
      locked: false,
      reason: null
    };
  }

  const secret = process.env[EMERGENCY_COMMAND_SECRET_ENV]?.trim();
  if (!secret) {
    return {
      locked: true,
      reason: `Human-in-the-loop Override engaged because ${path.basename(commandPath)} exists but ${EMERGENCY_COMMAND_SECRET_ENV} is not configured.`
    };
  }

  try {
    const raw = readFileSync(commandPath, "utf8").trim();
    if (!raw) {
      return {
        locked: true,
        reason: `Human-in-the-loop Override engaged because ${path.basename(commandPath)} is empty.`
      };
    }

    const command = JSON.parse(raw) as SignedEmergencyCommand;
    const payload = `${command.enabled}:${command.issuedAtIso8601}:${command.reason ?? ""}`;
    if (!verifySignature(payload, command.signature, secret)) {
      return {
        locked: true,
        reason: `Human-in-the-loop Override engaged because ${path.basename(commandPath)} signature verification failed.`
      };
    }

    const issuedAt = Date.parse(command.issuedAtIso8601);
    if (Number.isNaN(issuedAt)) {
      return {
        locked: true,
        reason: `Human-in-the-loop Override engaged because ${path.basename(commandPath)} timestamp is invalid.`
      };
    }

    if (Date.now() - issuedAt > getEmergencyCommandMaxAgeMs()) {
      return {
        locked: true,
        reason: `Human-in-the-loop Override engaged because ${path.basename(commandPath)} is stale.`
      };
    }

    if (command.enabled) {
      return {
        locked: true,
        reason:
          command.reason?.trim() ||
          `Human-in-the-loop Override engaged via signed ${path.basename(commandPath)}.`
      };
    }

    return {
      locked: false,
      reason: null
    };
  } catch {
    return {
      locked: true,
      reason: `Human-in-the-loop Override engaged because ${path.basename(commandPath)} is invalid.`
    };
  }
}

function verifySignature(payload: string, signature: string, secret: string): boolean {
  if (!signature || !secret) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(signature, "utf8");
  if (expectedBytes.length !== providedBytes.length) {
    return false;
  }

  return timingSafeEqual(expectedBytes, providedBytes);
}
