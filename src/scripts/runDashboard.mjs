import chalk from "chalk";

const width = 72;
const line = chalk.hex("#22404a")("=".repeat(width));

function pad(label, value) {
  const left = label.padEnd(22, " ");
  return `${chalk.hex("#7dd3c7")(left)} ${value}`;
}

function renderAgent(name, state, detail, accent) {
  const status = state === "READY"
    ? chalk.hex("#22c55e").bold(state)
    : state === "BLOCKED"
      ? chalk.hex("#ef4444").bold(state)
      : chalk.hex("#f59e0b").bold(state);

  console.log(chalk.hex(accent).bold(name));
  console.log(`  ${pad("State", status)}`);
  console.log(`  ${pad("Detail", chalk.white(detail))}`);
}

console.log(line);
console.log(chalk.bgHex("#0f172a").hex("#f8fafc").bold(" PROJECT SENTINEL COMMAND DASHBOARD "));
console.log(line);
console.log(pad("Mode", chalk.hex("#38bdf8")("Demo Presentation")));
console.log(pad("Kora", chalk.hex("#c084fc")("Gasless pathway online")));
console.log(pad("PolicyGuard", chalk.hex("#22c55e")("Intercepting all outbound transactions")));
console.log(pad("Swap Path", chalk.hex("#f59e0b")("Memo fallback + live Jupiter-ready")));
console.log("");
renderAgent("agent-1", "READY", "Swap intent approved and broadcast through Kora", "#38bdf8");
console.log("");
renderAgent("agent-2", "READY", "Concurrent execution within max-spend envelope", "#14b8a6");
console.log("");
renderAgent("agent-3", "BLOCKED", "Unauthorized drain attempt rejected by PolicyGuard", "#f97316");
console.log("");
console.log(chalk.hex("#94a3b8")("Legend: READY = safe execution, BLOCKED = denied before funds move"));
console.log(line);
