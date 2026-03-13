import {
  getManagedAgentName,
  getManagedOwnerId,
  logManagedAgentWallet,
  resolveManagedAgentWallet
} from "./managedAgentWallet";
import { createKoraSigner } from "./shared";

const DEFAULT_AGENT_NAME = "gasless-memo";

async function main(): Promise<void> {
  const managed = resolveManagedAgentWallet({
    agentName: getManagedAgentName({ defaultAgentName: DEFAULT_AGENT_NAME, env: process.env }),
    ownerId: getManagedOwnerId(process.env)
  });
  const walletManager = managed.walletManager;
  const koraSigner = createKoraSigner();
  const result = await koraSigner.submitGaslessMemo(
    walletManager,
    "PRKT gasless memo verification"
  );
  const modeLabel = result.fallbackReason
    ? "mock-fallback"
    : result.mock
      ? "mock"
      : "live";

  console.log("Gasless memo verification complete.");
  logManagedAgentWallet(managed);
  console.log(`Signature: ${result.signature}`);
  console.log(`Mode: ${modeLabel}`);
  if (result.fallbackReason) {
    console.log(`Fallback reason: ${result.fallbackReason}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Gasless memo failed: ${message}`);
  process.exitCode = 1;
});
