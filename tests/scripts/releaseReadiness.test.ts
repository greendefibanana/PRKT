import { mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

import {
  evaluateProductionTodo,
  findOpenBlockingTodoItems
} from "../../src/scripts/releaseReadiness";

describe("release readiness", () => {
  it("finds unchecked items in blocking sections", () => {
    const blockers = findOpenBlockingTodoItems(`
## P0 Blockers
- [ ] real blocker

## P2 Reliability and Multi-Agent Operations
- [ ] non-blocking backlog item

## Mainnet Deployment Gate (hard stop)
- [ ] hard stop
`);

    expect(blockers).toEqual([
      "P0 Blockers: real blocker",
      "Mainnet Deployment Gate (hard stop): hard stop"
    ]);
  });

  it("fails the production todo check when blocking items remain", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "prkt-release-"));
    const todoPath = path.join(tempDir, "PRODUCTION_READINESS_TODO.md");
    writeFileSync(
      todoPath,
      `
## P1 Security Hardening (must complete before any mainnet use)
- [ ] signer architecture
`
    );

    const result = evaluateProductionTodo(todoPath);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain(
      "P1 Security Hardening (must complete before any mainnet use): signer architecture"
    );

    rmSync(tempDir, { force: true, recursive: true });
  });

  it("passes the production todo check when blocking sections are cleared", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "prkt-release-"));
    const todoPath = path.join(tempDir, "PRODUCTION_READINESS_TODO.md");
    writeFileSync(
      todoPath,
      `
## P0 Blockers
- [x] done

## P1 Security Hardening (must complete before any mainnet use)
- [x] done

## P1 End-to-End Live Paths
- [x] done

## P0 Test and Release Gates
- [x] done

## Mainnet Deployment Gate (hard stop)
- [x] done
`
    );

    const result = evaluateProductionTodo(todoPath);

    expect(result.ok).toBe(true);

    rmSync(tempDir, { force: true, recursive: true });
  });
});
