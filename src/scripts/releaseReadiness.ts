import { existsSync, readFileSync } from "fs";
import { spawnSync } from "child_process";

export type CheckResult = {
  detail: string;
  ok: boolean;
  title: string;
};

const BLOCKING_TODO_SECTION_PREFIXES = [
  "## P0 Blockers",
  "## P1 Security Hardening",
  "## P1 End-to-End Live Paths",
  "## P0 Test and Release Gates",
  "## Mainnet Deployment Gate"
];

export function runCommandCheck(command: string, args: string[]): CheckResult {
  const result = spawnSync([command, ...args].join(" "), {
    shell: true,
    stdio: "inherit"
  });

  return {
    detail: `${command} ${args.join(" ")}`,
    ok: result.status === 0,
    title: `Command ${command}`
  };
}

export function evaluateProductionTodo(todoPath = "PRODUCTION_READINESS_TODO.md"): CheckResult {
  if (!existsSync(todoPath)) {
    return {
      detail: todoPath,
      ok: false,
      title: "Production TODO present"
    };
  }

  const blockingItems = findOpenBlockingTodoItems(readFileSync(todoPath, "utf8"));
  if (blockingItems.length === 0) {
    return {
      detail: "No open P0/P1/mainnet deployment blockers",
      ok: true,
      title: "Production blockers cleared"
    };
  }

  return {
    detail: blockingItems.join(" | "),
    ok: false,
    title: "Production blockers cleared"
  };
}

export function findOpenBlockingTodoItems(markdown: string): string[] {
  const openItems: string[] = [];
  let currentSection = "";

  for (const rawLine of markdown.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.startsWith("## ")) {
      currentSection = line;
      continue;
    }

    if (!BLOCKING_TODO_SECTION_PREFIXES.some((section) => currentSection.startsWith(section))) {
      continue;
    }

    const match = line.match(/^- \[ \] (.+)$/u);
    if (!match) {
      continue;
    }

    openItems.push(`${currentSection.replace(/^## /u, "")}: ${match[1]}`);
  }

  return openItems;
}

export function runReadinessChecks(): CheckResult[] {
  const npmCommand = "npm";
  const checks: CheckResult[] = [];

  checks.push({
    detail: ".env.example",
    ok: existsSync(".env.example"),
    title: "Env template present"
  });

  checks.push({
    detail: "SKILLS.md",
    ok: existsSync("SKILLS.md"),
    title: "Agent skills file present"
  });

  checks.push({
    detail: "README.md",
    ok: existsSync("README.md"),
    title: "README present"
  });

  checks.push(evaluateProductionTodo());
  checks.push(runCommandCheck(npmCommand, ["run", "build"]));
  checks.push(runCommandCheck("node", ["dist/cli/index.js", "--help"]));
  checks.push(runCommandCheck(npmCommand, ["run", "test:coverage"]));
  checks.push(runCommandCheck(npmCommand, ["pack", "--dry-run", "--cache", ".npm-cache"]));

  return checks;
}
