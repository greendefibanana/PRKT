import { runMultiAgentDevnetScenario } from "../scenarios/multiAgentDevnetScenario";

async function main(): Promise<void> {
  console.log("PRKT multi-agent devnet demo");
  const result = await runMultiAgentDevnetScenario();
  console.log(`RPC: ${result.rpc}`);
  console.log(`Demo mint: ${result.mintAddress}`);
  for (const signature of result.signatures) {
    console.log(`tx: ${signature}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Multi-agent devnet demo failed: ${message}`);
  process.exitCode = 1;
});
