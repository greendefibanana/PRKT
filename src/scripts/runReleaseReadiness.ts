import { runReadinessChecks } from "./releaseReadiness";

function main(): void {
  console.log("PRKT release readiness check");
  const checks = runReadinessChecks();

  let failures = 0;
  for (const check of checks) {
    const marker = check.ok ? "PASS" : "FAIL";
    console.log(`[${marker}] ${check.title} -> ${check.detail}`);
    if (!check.ok) {
      failures += 1;
    }
  }

  if (failures > 0) {
    console.error(`Release readiness failed with ${failures} failing check(s).`);
    process.exitCode = 1;
    return;
  }

  console.log("Release readiness passed.");
}

main();
