export type DemoMode = "LIVE" | "SIMULATED";

export function printDemoMode(mode: DemoMode, detail: string): void {
  console.log(`Mode: ${mode} (${detail})`);
}

