import { PolicyGuard } from "../policy/PolicyGuard";
import { SecurityViolationError } from "../policy/errors";
import { createDefaultAgentPolicy } from "../agent/policyFactory";
import { simulateAttack } from "../simulation/attack";
import {
  getManagedAgentName,
  getManagedOwnerId,
  resolveManagedAgentWallet
} from "./managedAgentWallet";

const DEFAULT_AGENT_NAME = "simulate-attack";

function main(): void {
  const managed = resolveManagedAgentWallet({
    agentName: getManagedAgentName({ defaultAgentName: DEFAULT_AGENT_NAME, env: process.env }),
    ownerId: getManagedOwnerId(process.env)
  });
  const walletManager = managed.walletManager;
  const policy = createDefaultAgentPolicy({
    whitelistedTransferDestinations: []
  });
  const policyGuard = new PolicyGuard(policy);

  try {
    simulateAttack(policyGuard, walletManager);
    console.error("Security failure: attack unexpectedly succeeded.");
    process.exitCode = 1;
  } catch (error: unknown) {
    if (error instanceof SecurityViolationError) {
      console.log("SecurityViolation detected. Attack blocked successfully.");
      console.log(error.message);
      return;
    }

    throw error;
  }
}

try {
  main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Attack simulation failed: ${message}`);
  process.exitCode = 1;
}
