import { mkdtempSync, readFileSync, rmSync } from "fs";
import os from "os";
import path from "path";

import {
  createIntentFile,
  extractJsonPayload,
  renderMarkdownReport,
  summarizeSteps,
  writeArtifacts
} from "../../src/scripts/runDevnetFeatureMatrix";

describe("runDevnetFeatureMatrix helpers", () => {
  it("extracts the trailing JSON object from mixed stdout", () => {
    const payload = extractJsonPayload([
      "Session valid | 3 entries | anchored at slot 123",
      "{",
      '  "valid": true,',
      '  "slot": 123',
      "}"
    ].join("\n"));

    expect(payload).toEqual({
      slot: 123,
      valid: true
    });
  });

  it("extracts the trailing JSON array from mixed stdout", () => {
    const payload = extractJsonPayload([
      "Managed wallets",
      "[",
      '  { "name": "alpha" },',
      '  { "name": "beta" }',
      "]"
    ].join("\n"));

    expect(payload).toEqual([
      { name: "alpha" },
      { name: "beta" }
    ]);
  });

  it("summarizes step counts and renders a markdown report", () => {
    const summary = {
      advanced: {
        agentId: "matrix-advanced-01",
        commitment: "abc123",
        policyAccountSignature: "policySig",
        proofSignature: "proofSig",
        sessionId: "session-01",
        sessionSignature: "sessionSig"
      },
      cluster: "devnet",
      generatedAtIso8601: "2026-03-12T18:00:00.000Z",
      names: {
        agent: "matrix-agent",
        gaslessAgent: "matrix-gasless",
        owner: "matrix-owner",
        wallet: "matrix-wallet"
      },
      steps: [
        { category: "cli", detail: "ready", name: "init", status: "ok" as const },
        { category: "live", detail: "optional", name: "protocol-demos", status: "skip" as const },
        { category: "custody", detail: "export path unavailable", name: "sensitive-exports", status: "warn" as const }
      ]
    };

    expect(summarizeSteps(summary.steps)).toEqual({
      fail: 0,
      ok: 1,
      skip: 1,
      total: 3,
      warn: 1
    });

    const markdown = renderMarkdownReport(summary);
    expect(markdown).toContain("# PRKT Devnet Feature Matrix");
    expect(markdown).toContain("Overall: PASS (1 ok, 1 warn, 1 skip, 0 fail)");
    expect(markdown).toContain("| cli | init | OK | ready |");
    expect(markdown).toContain("- Session ID: session-01");
  });

  it("writes both JSON and markdown artifacts", () => {
    const originalCwd = process.cwd();
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "prkt-matrix-artifacts-"));
    process.chdir(tempDir);

    try {
      const artifacts = writeArtifacts({
        cluster: "devnet",
        generatedAtIso8601: "2026-03-12T18:00:00.000Z",
        names: {
          agent: "matrix-agent",
          gaslessAgent: "matrix-gasless",
          owner: "matrix-owner",
          wallet: "matrix-wallet"
        },
        steps: [
          { category: "cli", detail: "ready", name: "init", status: "ok" }
        ]
      });

      expect(readFileSync(artifacts.jsonPath, "utf8")).toContain('"cluster": "devnet"');
      expect(readFileSync(artifacts.markdownPath, "utf8")).toContain("# PRKT Devnet Feature Matrix");
    } finally {
      process.chdir(originalCwd);
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it("creates an intent file with the target public key", () => {
    const intentPath = createIntentFile("AgentPublicKey1111111111111111111111111111111");
    const raw = readFileSync(intentPath, "utf8");
    expect(raw).toContain('"type": "transfer-sol"');
    expect(raw).toContain('"to": "AgentPublicKey1111111111111111111111111111111"');
    rmSync(intentPath, { force: true });
  });
});
