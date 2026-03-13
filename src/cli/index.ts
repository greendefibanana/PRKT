#!/usr/bin/env node
import { readFileSync } from "fs";

import { getMint } from "@solana/spl-token";
import { Command } from "commander";
import {
  LAMPORTS_PER_SOL,
  PublicKey
} from "@solana/web3.js";

import { AgentRegistryStore } from "./services/agentRegistry";
import { runAgentOnce } from "./services/agentRuntime";
import { ActivityStore } from "./services/activityStore";
import { getCliDataDir, probeCliDataDir } from "./services/storagePaths";
import { WalletRegistry } from "./services/walletRegistry";
import { getPlatformMasterKeySource } from "./services/walletCrypto";
import { failWithMessage, printResult, txExplorer, addressExplorer } from "./utils/output";
import {
  detectClusterFromRpcUrl,
  getKoraRpcUrl,
  getOptionalSecretKey,
  getOptionalDevnetTreasurySecretKey,
  getRemoteSignerConfig,
  getRpcUrl,
  getUsdcMintAddress,
  isLiveRaydiumLpEnabled,
  isLiveSwapPathEnabled,
  isUniversalDeFiLiveFirstEnabled
} from "../config/env";
import {
  DEFAULT_POLICY_PRESET,
  listPolicyPresetSummaries,
  resolvePolicyConfig
} from "../config/policyPresets";
import { RpcClient } from "../core/rpc/RpcClient";
import { TransactionService } from "../core/transactions/TransactionService";
import { TokenService } from "../core/tokens/TokenService";
import { BalanceService } from "../core/balances/BalanceService";
import { DevnetFundingService } from "../core/funding/DevnetFundingService";
import { runMultiAgentDevnetScenario } from "../demo/scenarios/multiAgentDevnetScenario";
import { PolicyEngine } from "../policy";
import {
  buildBashCompletion,
  buildPowerShellCompletion,
  buildZshCompletion
} from "./utils/completion";

type GlobalOptions = {
  json?: boolean;
};

const CLI_BANNER = String.raw`██████╗ ██████╗ ██╗  ██╗████████╗
██╔══██╗██╔══██╗██║ ██╔╝╚══██╔══╝
██████╔╝██████╔╝█████╔╝    ██║
██╔═══╝ ██╔══██╗██╔═██╗    ██║
██║     ██║  ██║██║  ██╗   ██║
╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝

Policy-Enforced Autonomous Agent Runtime
Solana Infrastructure Layer`;

const program = new Command();
const walletRegistry = new WalletRegistry();
const agentRegistry = new AgentRegistryStore(walletRegistry);
const activityStore = new ActivityStore();
const CUSTODY_MODEL = "local-per-user";
const POLICY_EXECUTION_MODEL = "user-owned agent wallets with policy-guarded execution";

function shouldPrintStartupBanner(argv: string[]): boolean {
  if (argv.includes("--json")) {
    return false;
  }

  return !argv.includes("completion");
}

function inspectSignerConfiguration(): {
  detail: string;
  status: "fail" | "ok" | "warn";
} {
  try {
    const remoteSigner = getRemoteSignerConfig();
    if (remoteSigner) {
      return {
        detail: `remote signer ${remoteSigner.publicKey.toBase58()}`,
        status: "ok"
      };
    }

    const treasurySecretKey = getOptionalDevnetTreasurySecretKey();
    if (treasurySecretKey) {
      return {
        detail: "devnet treasury key present",
        status: "ok"
      };
    }

    const localSecretKey = getOptionalSecretKey();
    if (localSecretKey) {
      return {
        detail: "local demo key present",
        status: "ok"
      };
    }

    return {
      detail: "missing signer configuration",
      status: "warn"
    };
  } catch (error: unknown) {
    return {
      detail: error instanceof Error ? error.message : "invalid signer configuration",
      status: "fail"
    };
  }
}

function outputOptions(command: unknown): { json: boolean } {
  if (
    command &&
    typeof command === "object" &&
    "optsWithGlobals" in command &&
    typeof (command as { optsWithGlobals?: unknown }).optsWithGlobals === "function"
  ) {
    const options = (command as Command).optsWithGlobals<GlobalOptions>();
    return {
      json: Boolean(options.json)
    };
  }

  if (
    command &&
    typeof command === "object" &&
    "opts" in command &&
    typeof (command as { opts?: unknown }).opts === "function"
  ) {
    const options = (command as Command).opts<GlobalOptions>();
    return {
      json: Boolean(options.json)
    };
  }

  const options =
    command && typeof command === "object" && "json" in command
      ? (command as GlobalOptions)
      : {};

  return {
    json: Boolean(options.json)
  };
}

function activity(kind: Parameters<ActivityStore["append"]>[0]["kind"], details: Record<string, unknown>, extra?: {
  agent?: string;
  signature?: string;
}): void {
  try {
    activityStore.append({
      createdAtIso: new Date().toISOString(),
      kind,
      details,
      ...extra
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown activity-store error";
    console.error(`Activity log warning: ${message}`);
  }
}

function resolveWalletName(entity: string): string {
  const wallet = walletRegistry.find(entity);
  if (wallet) {
    return wallet.name;
  }
  const agent = agentRegistry.find(entity);
  if (agent) {
    return agent.walletName;
  }
  throw new Error(`Unknown wallet/agent '${entity}'.`);
}

function resolveAgentRecord(agentId: string) {
  const agent = agentRegistry.find(agentId);
  if (agent) {
    return agent;
  }

  const wallet = walletRegistry.find(agentId);
  if (wallet) {
    return agentRegistry.ensureForWallet(wallet.name);
  }

  throw new Error(`Unknown agent '${agentId}'.`);
}

function parseSol(input: string): number {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("amount must be a positive number");
  }
  return value;
}

function parseOptionalCsv(input: string | undefined): string[] | undefined {
  if (!input) {
    return undefined;
  }

  const values = input
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return values.length > 0 ? values : [];
}

function parseOptionalPositiveInteger(input: string | undefined, fieldName: string): number | undefined {
  if (input === undefined) {
    return undefined;
  }

  const parsed = Number(input);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }

  return parsed;
}

async function buildServices() {
  const rpcClient = new RpcClient(getRpcUrl(), "confirmed");
  const tokenService = new TokenService(rpcClient);
  const transactionService = new TransactionService(rpcClient);
  const balanceService = new BalanceService(rpcClient, tokenService);
  return { balanceService, rpcClient, tokenService, transactionService };
}

async function buildOverviewRows(): Promise<Array<Record<string, string>>> {
  const { balanceService } = await buildServices();
  const agents = agentRegistry.synchronizeWithWallets();
  const rows: Array<Record<string, string>> = [];
  for (const entry of agents) {
    const wallet = walletRegistry.find(entry.walletName);
    if (!wallet) {
      continue;
    }
    const owner = new PublicKey(wallet.publicKey);
    const sol = await balanceService.getSolBalance(owner);
    const trackedMints = entry.trackedMints ?? [];
    const trackedSpl = [];
    for (const mint of trackedMints) {
      const balance = await balanceService.getSplTokenBalance({
        owner,
        mint: new PublicKey(mint)
      });
      trackedSpl.push(`${mint.slice(0, 6)}...:${balance.toFixed(4)}`);
    }
    rows.push({
      agent: entry.name,
      lastAction: entry.lastAction ?? "-",
      lastSignature: entry.lastSignature ?? "-",
      policyMode: entry.policyMode,
      sol: sol.toFixed(4),
      status: entry.status,
      trackedSpl: trackedSpl.join(", ") || "-",
      wallet: wallet.publicKey
    });
  }
  return rows;
}

program
  .name("prkt")
  .description("PRKT CLI - Solana agentic wallet operations")
  .option("--json", "output machine-readable JSON");

program
  .command("init")
  .description("initialize local PRKT state for this user install")
  .action((_, command: Command) => {
    const dataDirStatus = probeCliDataDir();
    const payload = {
      cliDataDir: dataDirStatus.path,
      cliDataDirHealth: dataDirStatus.details,
      cliDataDirWritable: dataDirStatus.writable,
      custodyModel: CUSTODY_MODEL,
      masterKeySource: getPlatformMasterKeySource(),
      policyExecutionModel: POLICY_EXECUTION_MODEL,
      recommendedNextSteps: [
        "Run `prkt config show` to inspect runtime config",
        "Run `prkt wallet create --name <name>` or `prkt agent create --agent <id>` to provision a wallet",
        "Use `prkt policy show --agent <agent>` and `prkt policy set-limits ...` before enabling live execution"
      ]
    };
    activity("config", { action: "init" });
    printResult(outputOptions(command), payload, "PRKT initialized");
  });

program
  .command("verify-session <sessionId>")
  .option("--commitment <hash>", "on-chain commitment hash")
  .description("verify an agent session log against the compressed session anchor on Solana devnet")
  .action(async (sessionId, options) => {
    const { SessionAnchor } = await import("../anchoring/SessionAnchor");
    const { defaultPRKTConfig } = await import("../config/PRKTConfig");
    const anchor = new SessionAnchor(defaultPRKTConfig.zkCompression.rpcEndpoint);

    try {
      const result = await anchor.verifySession(sessionId, options.commitment);
      const output = outputOptions(program);

      if (!output.json && result.valid) {
        console.log(
          `Session valid ✓ | ${result.entryCount} entries | anchored at slot ${result.slot ?? "unknown"}`
        );
      } else if (!output.json) {
        console.log(`Session invalid ✗${result.reason ? ` | ${result.reason}` : ""}`);
      }

      printResult(output, result, "Session verification");
    } catch (error) {
      failWithMessage(error);
    }
  });

program
  .command("verify-tx <txSignature>")
  .description("verify a transaction's compressed policy proof on Solana devnet")
  .action(async (txSignature) => {
    const { ProofAnchor } = await import("../zk/ProofAnchor");
    const { defaultPRKTConfig } = await import("../config/PRKTConfig");
    const anchor = new ProofAnchor(defaultPRKTConfig.zkCompression.rpcEndpoint);

    try {
      const result = await anchor.verifyProof(txSignature);
      const output = outputOptions(program);
      if (!output.json && result.valid) {
        console.log(
          `Policy attestation valid ✓ | prover ${result.attestation?.prover ?? "unknown"} | slot ${result.slot ?? "unknown"}`
        );
      } else if (!output.json) {
        console.log(`Policy attestation invalid ✗${result.reason ? ` | ${result.reason}` : ""}`);
      }

      printResult(output, result, "Transaction proof verification");
    } catch (error) {
      failWithMessage(error);
    }
  });

const wallet = program.command("wallet").description("wallet management and transfers");

wallet
  .command("create")
  .requiredOption("--name <name>", "wallet name")
  .description("create a managed wallet")
  .action((options, command: Command) => {
    const created = walletRegistry.create(options.name);
    const agent = agentRegistry.ensureForWallet(options.name);
    activity("wallet", { action: "create", name: options.name, publicKey: created.record.publicKey });
    printResult(outputOptions(command), {
      custodyModel: CUSTODY_MODEL,
      dataDir: getCliDataDir(),
      defaultPolicyPreset: agent.policyPreset,
      explorer: addressExplorer(created.record.publicKey),
      name: created.record.name,
      publicKey: created.record.publicKey,
      masterKeySource: getPlatformMasterKeySource(),
      recoveryKey: created.recoveryKey
    }, `Wallet ${options.name} created`);
  });

wallet
  .command("list")
  .description("list managed wallets")
  .action((_, command: Command) => {
    const wallets = walletRegistry.list().map((entry) => ({
      createdAt: entry.createdAtIso,
      name: entry.name,
      publicKey: entry.publicKey
    }));
    printResult(outputOptions(command), wallets, "Managed wallets");
  });

wallet
  .command("show")
  .requiredOption("--name <name>", "wallet name")
  .description("show wallet details")
  .action((options, command: Command) => {
    const record = walletRegistry.find(options.name);
    if (!record) {
      throw new Error(`Wallet '${options.name}' not found.`);
    }
    printResult(outputOptions(command), {
      createdAt: record.createdAtIso,
      explorer: addressExplorer(record.publicKey),
      name: record.name,
      publicKey: record.publicKey
    }, `Wallet ${options.name}`);
  });

wallet
  .command("fund")
  .requiredOption("--name <name>", "wallet name")
  .requiredOption("--sol <amount>", "amount in SOL")
  .description("fund wallet from treasury if configured, otherwise request devnet airdrop")
  .action(async (options, command: Command) => {
    const amountSol = parseSol(options.sol);
    const walletName = resolveWalletName(options.name);
    const walletManager = walletRegistry.toWalletManager(walletName);
    const { balanceService, rpcClient, transactionService } = await buildServices();
    const fundingService = new DevnetFundingService(rpcClient, transactionService);
    const funding = await fundingService.fundExactSol({
      amountSol,
      recipient: walletManager.publicKey
    });
    const updatedBalance = await fundingService.waitForMinimumBalance({
      attempts: 15,
      balanceService,
      minimumSol: amountSol,
      recipient: walletManager.publicKey
    });
    activity("wallet", {
      action: "fund",
      amountSol,
      method: funding.source,
      name: options.name
    }, { signature: funding.signature });
    printResult(outputOptions(command), {
      amountSol,
      balanceSol: updatedBalance,
      explorer: txExplorer(funding.signature),
      signature: funding.signature,
      source: funding.source,
      wallet: walletName
    }, `Wallet ${walletName} funded`);
  });

wallet
  .command("balance")
  .requiredOption("--name <name>", "wallet name")
  .description("fetch SOL balance")
  .action(async (options, command: Command) => {
    const walletName = resolveWalletName(options.name);
    const walletManager = walletRegistry.toWalletManager(walletName);
    const { balanceService } = await buildServices();
    const sol = await balanceService.getSolBalance(walletManager.publicKey);
    printResult(outputOptions(command), {
      balanceSol: sol,
      name: walletName,
      publicKey: walletManager.publicKey.toBase58()
    }, `SOL balance for ${walletName}`);
  });

wallet
  .command("balance-spl")
  .requiredOption("--name <name>", "wallet name")
  .requiredOption("--mint <mint>", "mint address")
  .description("fetch SPL token balance for wallet")
  .action(async (options, command: Command) => {
    const walletName = resolveWalletName(options.name);
    const walletManager = walletRegistry.toWalletManager(walletName);
    const { balanceService } = await buildServices();
    const mint = new PublicKey(options.mint);
    const balance = await balanceService.getSplTokenBalance({
      owner: walletManager.publicKey,
      mint
    });
    printResult(outputOptions(command), {
      balance,
      mint: mint.toBase58(),
      name: walletName
    }, `SPL balance for ${walletName}`);
  });

wallet
  .command("export-secret")
  .requiredOption("--name <name>", "wallet name or agent id")
  .requiredOption("--recovery-key <key>", "wallet recovery key")
  .description("decrypt and export the managed wallet secret key")
  .action((options, command: Command) => {
    const walletName = resolveWalletName(options.name);
    const secretKey = Array.from(
      walletRegistry.exportSecretKeyWithRecovery({
        name: walletName,
        recoveryKey: String(options.recoveryKey)
      })
    );
    const wallet = walletRegistry.find(walletName);
    printResult(outputOptions(command), {
      publicKey: wallet?.publicKey ?? "<missing>",
      secretKey,
      wallet: walletName
    }, `Wallet ${walletName} exported`);
  });

wallet
  .command("transfer-sol")
  .requiredOption("--from <wallet>", "source wallet name")
  .requiredOption("--to <pubkey>", "destination public key")
  .requiredOption("--amount <amount>", "amount in SOL")
  .description("transfer SOL")
  .action(async (options, command: Command) => {
    const walletManager = walletRegistry.toWalletManager(resolveWalletName(options.from));
    const to = new PublicKey(options.to);
    const amountSol = parseSol(options.amount);
    const { transactionService } = await buildServices();
    const built = await transactionService.buildTransaction({
      feePayer: walletManager.publicKey,
      instructions: [
        transactionService.buildSolTransferInstructionInSol({
          from: walletManager.publicKey,
          to,
          amountSol
        })
      ],
      signer: walletManager
    });
    const send = await transactionService.sendAndConfirm(built);
    activity("transfer", {
      amountSol,
      from: options.from,
      to: options.to,
      type: "sol"
    }, { signature: send.signature });
    printResult(outputOptions(command), {
      amountSol,
      explorer: txExplorer(send.signature),
      signature: send.signature
    }, "SOL transfer sent");
  });

wallet
  .command("transfer-spl")
  .requiredOption("--from <wallet>", "source wallet name")
  .requiredOption("--to <pubkey>", "destination owner public key")
  .requiredOption("--mint <mint>", "mint address")
  .requiredOption("--amount <amount>", "amount in UI units")
  .description("transfer SPL tokens")
  .action(async (options, command: Command) => {
    const walletManager = walletRegistry.toWalletManager(resolveWalletName(options.from));
    const destinationOwner = new PublicKey(options.to);
    const mint = new PublicKey(options.mint);
    const amountUi = parseSol(options.amount);
    const { rpcClient, tokenService, transactionService } = await buildServices();

    const mintInfo = await getMint(rpcClient.connection, mint, "confirmed");
    const amountRaw = BigInt(Math.round(amountUi * 10 ** mintInfo.decimals));
    const sourceAta = tokenService.findAssociatedTokenAddress(walletManager.publicKey, mint);
    const ensureDestination = await tokenService.ensureAtaInstruction({
      mint,
      owner: destinationOwner,
      payer: walletManager.publicKey
    });

    const instructions = [
      ...(ensureDestination.createInstruction ? [ensureDestination.createInstruction] : []),
      transactionService.buildSplTransferCheckedInstruction({
        sourceAta,
        mint,
        destinationAta: ensureDestination.address,
        owner: walletManager.publicKey,
        amount: amountRaw,
        decimals: mintInfo.decimals
      })
    ];
    const built = await transactionService.buildTransaction({
      feePayer: walletManager.publicKey,
      instructions,
      signer: walletManager
    });
    const send = await transactionService.sendAndConfirm(built);
    activity("transfer", {
      amountRaw: amountRaw.toString(),
      amountUi,
      from: options.from,
      mint: mint.toBase58(),
      to: options.to,
      type: "spl"
    }, { signature: send.signature });
    printResult(outputOptions(command), {
      explorer: txExplorer(send.signature),
      signature: send.signature
    }, "SPL transfer sent");
  });

const token = program.command("token").description("SPL token operations");

token
  .command("mint-demo")
  .requiredOption("--authority <wallet>", "authority wallet name")
  .requiredOption("--decimals <n>", "mint decimals")
  .requiredOption("--amount <amount>", "amount in UI units")
  .description("create demo mint and mint tokens to authority ATA")
  .action(async (options, command: Command) => {
    const authority = walletRegistry.toWalletManager(options.authority);
    const decimals = Number(options.decimals);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9) {
      throw new Error("decimals must be an integer between 0 and 9");
    }
    const amountUi = parseSol(options.amount);
    const { tokenService, transactionService } = await buildServices();
    const mintSetup = await tokenService.buildCreateMintInstructions({
      payer: authority.publicKey,
      mintAuthority: authority.publicKey,
      decimals
    });
    const mintTx = await transactionService.buildTransaction({
      feePayer: authority.publicKey,
      instructions: mintSetup.instructions,
      signer: authority
    });
    mintTx.transaction.sign([mintSetup.mintKeypair]);
    await transactionService.sendAndConfirm(mintTx);

    const authorityAta = await tokenService.ensureAtaInstruction({
      mint: mintSetup.mintKeypair.publicKey,
      owner: authority.publicKey,
      payer: authority.publicKey
    });
    const raw = BigInt(Math.round(amountUi * 10 ** decimals));
    const mintToTx = await transactionService.buildTransaction({
      feePayer: authority.publicKey,
      instructions: [
        ...(authorityAta.createInstruction ? [authorityAta.createInstruction] : []),
        tokenService.buildMintToInstruction({
          mint: mintSetup.mintKeypair.publicKey,
          destinationAta: authorityAta.address,
          authority: authority.publicKey,
          amount: raw
        })
      ],
      signer: authority
    });
    const send = await transactionService.sendAndConfirm(mintToTx);
    activity("token", {
      action: "mint-demo",
      amountRaw: raw.toString(),
      amountUi,
      authority: options.authority,
      decimals,
      mint: mintSetup.mintKeypair.publicKey.toBase58()
    }, { signature: send.signature });
    printResult(outputOptions(command), {
      explorer: txExplorer(send.signature),
      mint: mintSetup.mintKeypair.publicKey.toBase58(),
      signature: send.signature
    }, "Demo mint created");
  });

token
  .command("create-ata")
  .requiredOption("--owner <wallet>", "owner wallet name")
  .requiredOption("--mint <mint>", "mint address")
  .description("create ATA if missing")
  .action(async (options, command: Command) => {
    const owner = walletRegistry.toWalletManager(options.owner);
    const mint = new PublicKey(options.mint);
    const { tokenService, transactionService } = await buildServices();
    const ata = await tokenService.ensureAtaInstruction({
      mint,
      owner: owner.publicKey,
      payer: owner.publicKey
    });
    if (!ata.createInstruction) {
      printResult(outputOptions(command), {
        ata: ata.address.toBase58(),
        existed: true
      }, "ATA already exists");
      return;
    }
    const tx = await transactionService.buildTransaction({
      feePayer: owner.publicKey,
      instructions: [ata.createInstruction],
      signer: owner
    });
    const send = await transactionService.sendAndConfirm(tx);
    activity("token", {
      action: "create-ata",
      mint: mint.toBase58(),
      owner: options.owner
    }, { signature: send.signature });
    printResult(outputOptions(command), {
      ata: ata.address.toBase58(),
      explorer: txExplorer(send.signature),
      signature: send.signature
    }, "ATA created");
  });

const policy = program.command("policy").description("policy inspection");

policy
  .command("show")
  .requiredOption("--agent <agent>", "agent name")
  .description("show policy for agent")
  .action((options, command: Command) => {
    const agent = resolveAgentRecord(options.agent);
    const resolved = resolvePolicyConfig({
      agentId: agent.name,
      overrides: agent.policyOverrides,
      presetName: agent.policyPreset ?? DEFAULT_POLICY_PRESET
    });
    printResult(outputOptions(command), {
      overrides: agent.policyOverrides ?? null,
      policyMode: agent.policyMode,
      preset: agent.policyPreset ?? DEFAULT_POLICY_PRESET,
      resolvedConfig: resolved
    }, `Policy for ${agent.name}`);
  });

policy
  .command("presets")
  .description("list available provider policy presets")
  .action((_, command: Command) => {
    printResult(outputOptions(command), listPolicyPresetSummaries(), "Policy presets");
  });

policy
  .command("set-preset")
  .requiredOption("--agent <agent>", "agent name")
  .requiredOption("--preset <preset>", "preset name")
  .description("assign a provider policy preset to an agent")
  .action((options, command: Command) => {
    const record = resolveAgentRecord(options.agent);
    const preset = options.preset as typeof record.policyPreset;
    if (!listPolicyPresetSummaries().some((entry) => entry.name === preset)) {
      throw new Error(`Unknown policy preset '${options.preset}'.`);
    }

    const policyMode = preset === "guarded-live" ? "live" : "sandbox";
    const updated = agentRegistry.patch(record.name, {
      policyMode,
      policyPreset: preset
    });
    printResult(outputOptions(command), updated, `Policy preset updated for ${record.name}`);
  });

policy
  .command("set-limits")
  .requiredOption("--agent <agent>", "agent name")
  .option("--approval-mode <mode>", "sandbox or live")
  .option("--max-sol-per-tx-lamports <n>", "max lamports per transaction")
  .option("--max-spl-per-tx-raw <n>", "max raw SPL units per transaction")
  .option("--max-transactions-per-session <n>", "max transactions per session")
  .option("--max-transactions-per-day <n>", "max transactions per day")
  .option("--session-ttl-minutes <n>", "session ttl in minutes")
  .option("--allowed-mints <csv>", "comma-separated allowed mint addresses")
  .option("--allowed-close-destinations <csv>", "comma-separated destinations allowed for token-account close refunds")
  .option("--allowed-destinations <csv>", "comma-separated allowed destination addresses")
  .option("--extra-program-ids <csv>", "comma-separated extra allowed program ids")
  .option("--allow-opaque-program-ids <csv>", "comma-separated opaque programs to allow")
  .option("--deny-unknown-instructions <true|false>", "override unknown-instruction deny behavior")
  .option("--require-simulation-success <true|false>", "override simulation requirement")
  .option("--reject-suspicious-balance-deltas <true|false>", "override suspicious delta rejection")
  .description("set or replace persisted policy overrides for an agent")
  .action((options, command: Command) => {
    const record = resolveAgentRecord(options.agent);
    const approvalMode =
      options.approvalMode === undefined ? undefined : String(options.approvalMode);
    if (approvalMode !== undefined && approvalMode !== "sandbox" && approvalMode !== "live") {
      throw new Error("--approval-mode must be 'sandbox' or 'live'");
    }

    const updated = agentRegistry.patch(record.name, {
      policyMode: (approvalMode as "sandbox" | "live" | undefined) ?? record.policyMode,
      policyOverrides: {
        allowOpaqueProgramIds: parseOptionalCsv(options.allowOpaqueProgramIds),
        allowedCloseAccountDestinations: parseOptionalCsv(options.allowedCloseDestinations),
        allowedMints: parseOptionalCsv(options.allowedMints),
        allowedTransferDestinations: parseOptionalCsv(options.allowedDestinations),
        approvalMode: approvalMode as "sandbox" | "live" | undefined,
        denyUnknownInstructionsByDefault:
          options.denyUnknownInstructions === undefined
            ? undefined
            : String(options.denyUnknownInstructions).toLowerCase() === "true",
        extraAllowedProgramIds: parseOptionalCsv(options.extraProgramIds),
        maxSolPerTxLamports: parseOptionalPositiveInteger(
          options.maxSolPerTxLamports,
          "max-sol-per-tx-lamports"
        ),
        maxSplPerTxRawAmount: options.maxSplPerTxRaw
          ? String(BigInt(options.maxSplPerTxRaw))
          : undefined,
        maxTransactionsPerDay: parseOptionalPositiveInteger(
          options.maxTransactionsPerDay,
          "max-transactions-per-day"
        ),
        maxTransactionsPerSession: parseOptionalPositiveInteger(
          options.maxTransactionsPerSession,
          "max-transactions-per-session"
        ),
        rejectSuspiciousBalanceDeltas:
          options.rejectSuspiciousBalanceDeltas === undefined
            ? undefined
            : String(options.rejectSuspiciousBalanceDeltas).toLowerCase() === "true",
        requireSimulationSuccess:
          options.requireSimulationSuccess === undefined
            ? undefined
            : String(options.requireSimulationSuccess).toLowerCase() === "true",
        sessionTtlMinutes: parseOptionalPositiveInteger(
          options.sessionTtlMinutes,
          "session-ttl-minutes"
        )
      }
    });

    printResult(outputOptions(command), updated, `Policy overrides updated for ${record.name}`);
  });

policy
  .command("clear-overrides")
  .requiredOption("--agent <agent>", "agent name")
  .description("clear persisted policy overrides for an agent")
  .action((options, command: Command) => {
    const record = resolveAgentRecord(options.agent);
    const updated = agentRegistry.patch(record.name, {
      policyOverrides: undefined
    });
    printResult(outputOptions(command), updated, `Policy overrides cleared for ${record.name}`);
  });

policy
  .command("validate-intent")
  .requiredOption("--agent <agent>", "agent name")
  .requiredOption("--intent-file <file>", "path to intent JSON")
  .description("validate intent-like transaction against policy")
  .action(async (options, command: Command) => {
    const agent = resolveAgentRecord(options.agent);
    const intentRaw = JSON.parse(readFileSync(options.intentFile, "utf8")) as {
      type: string;
      [key: string]: unknown;
    };
    const walletManager = walletRegistry.toWalletManager(agent.walletName);
    const config = resolvePolicyConfig({
      agentId: agent.name,
      overrides: agent.policyOverrides,
      presetName: agent.policyPreset ?? DEFAULT_POLICY_PRESET
    });
    const engine = new PolicyEngine(config);
    const { tokenService, transactionService } = await buildServices();

    let inspection;
    if (intentRaw.type === "write-memo") {
      const tx = await transactionService.buildTransaction({
        feePayer: walletManager.publicKey,
        instructions: [transactionService.buildMemoInstruction(String(intentRaw.memo ?? ""))],
        signer: walletManager
      });
      inspection = engine.inspect(tx.transaction);
    } else if (intentRaw.type === "transfer-sol") {
      const tx = await transactionService.buildTransaction({
        feePayer: walletManager.publicKey,
        instructions: [
          transactionService.buildSolTransferInstruction({
            from: walletManager.publicKey,
            to: new PublicKey(String(intentRaw.to)),
            lamports: Number(intentRaw.lamports)
          })
        ],
        signer: walletManager
      });
      inspection = engine.inspect(tx.transaction);
    } else if (intentRaw.type === "transfer-spl") {
      const mint = new PublicKey(String(intentRaw.mint));
      const mintDecimals = await tokenService.getMintDecimals(mint);
      const sourceAta = tokenService.findAssociatedTokenAddress(walletManager.publicKey, mint);
      const destOwner = new PublicKey(String(intentRaw.toOwner));
      const destinationAta = tokenService.findAssociatedTokenAddress(destOwner, mint);
      const tx = await transactionService.buildTransaction({
        feePayer: walletManager.publicKey,
        instructions: [
          transactionService.buildSplTransferCheckedInstruction({
            sourceAta,
            mint,
            destinationAta,
            owner: walletManager.publicKey,
            amount: BigInt(String(intentRaw.amountRaw)),
            decimals: mintDecimals
          })
        ],
        signer: walletManager
      });
      inspection = engine.inspect(tx.transaction);
    } else {
      throw new Error(
        "Unsupported intent type for validate-intent. Supported: write-memo, transfer-sol, transfer-spl"
      );
    }

    activity("policy", {
      action: "validate-intent",
      agent: options.agent,
      intentType: intentRaw.type
    });
    printResult(outputOptions(command), inspection, "Policy inspection result");
  });

const agent = program.command("agent").description("agent management");

agent
  .command("create")
  .requiredOption("--agent <name>", "agent id")
  .option("--owner <owner>", "owner id")
  .description("create an agent with an encrypted managed wallet")
  .action((options, command: Command) => {
    const createdWallet = walletRegistry.create(options.agent);
    const createdAgent = agentRegistry.createAgent({
      agentId: options.agent,
      ownerId: options.owner,
      walletName: createdWallet.record.name
    });
    activity("agent", {
      action: "create",
      ownerId: options.owner ?? null,
      wallet: createdWallet.record.name
    }, { agent: createdAgent.name });
    printResult(outputOptions(command), {
      agent: createdAgent.name,
      custodyModel: CUSTODY_MODEL,
      dataDir: getCliDataDir(),
      defaultPolicyPreset: createdAgent.policyPreset,
      masterKeySource: getPlatformMasterKeySource(),
      ownerId: createdAgent.ownerId ?? null,
      publicKey: createdWallet.record.publicKey,
      recoveryKey: createdWallet.recoveryKey,
      wallet: createdAgent.walletName
    }, `Agent ${createdAgent.name} created`);
  });

agent
  .command("fund")
  .requiredOption("--agent <name>", "agent id")
  .requiredOption("--sol <amount>", "amount in SOL")
  .description("fund an agent wallet from treasury if configured, otherwise request devnet airdrop")
  .action(async (options, command: Command) => {
    const record = resolveAgentRecord(options.agent);
    const amountSol = parseSol(options.sol);
    const walletManager = walletRegistry.toWalletManager(record.walletName);
    const { balanceService, rpcClient, transactionService } = await buildServices();
    const fundingService = new DevnetFundingService(rpcClient, transactionService);
    const funding = await fundingService.fundExactSol({
      amountSol,
      recipient: walletManager.publicKey
    });
    const updatedBalance = await fundingService.waitForMinimumBalance({
      attempts: 15,
      balanceService,
      minimumSol: amountSol,
      recipient: walletManager.publicKey
    });
    activity("agent", {
      action: "fund",
      amountSol,
      ownerId: record.ownerId ?? null
    }, { agent: record.name, signature: funding.signature });
    printResult(outputOptions(command), {
      agent: record.name,
      balanceSol: updatedBalance,
      explorer: txExplorer(funding.signature),
      publicKey: walletManager.publicKey.toBase58(),
      signature: funding.signature,
      source: funding.source
    }, `Agent ${record.name} funded`);
  });

agent
  .command("balance")
  .requiredOption("--agent <name>", "agent id")
  .description("fetch SOL balance for the agent wallet")
  .action(async (options, command: Command) => {
    const record = resolveAgentRecord(options.agent);
    const walletManager = walletRegistry.toWalletManager(record.walletName);
    const { balanceService } = await buildServices();
    const sol = await balanceService.getSolBalance(walletManager.publicKey);
    printResult(outputOptions(command), {
      agent: record.name,
      balanceSol: sol,
      publicKey: walletManager.publicKey.toBase58(),
      wallet: record.walletName
    }, `SOL balance for ${record.name}`);
  });

agent
  .command("export-wallet")
  .requiredOption("--agent <name>", "agent id")
  .requiredOption("--recovery-key <key>", "wallet recovery key")
  .description("decrypt and export the agent wallet secret key")
  .action((options, command: Command) => {
    const record = resolveAgentRecord(options.agent);
    const secretKey = Array.from(
      walletRegistry.exportSecretKeyWithRecovery({
        name: record.walletName,
        recoveryKey: String(options.recoveryKey)
      })
    );
    const wallet = walletRegistry.find(record.walletName);
    printResult(outputOptions(command), {
      agent: record.name,
      ownerId: record.ownerId ?? null,
      publicKey: wallet?.publicKey ?? "<missing>",
      secretKey,
      wallet: record.walletName
    }, `Agent ${record.name} wallet exported`);
  });

agent
  .command("list")
  .description("list registered agents")
  .action((_, command: Command) => {
    const agents = agentRegistry.synchronizeWithWallets().map((record) => ({
      lastRunAt: record.lastRunAtIso ?? "-",
      name: record.name,
      ownerId: record.ownerId ?? "-",
      policyMode: record.policyMode,
      policyPreset: record.policyPreset,
      status: record.status,
      strategy: record.strategy,
      wallet: record.walletName
    }));
    printResult(outputOptions(command), agents, "Agents");
  });

agent
  .command("show")
  .requiredOption("--agent <name>", "agent name")
  .description("show agent details")
  .action((options, command: Command) => {
    const record = resolveAgentRecord(options.agent);
    const wallet = walletRegistry.find(record.walletName);
    printResult(outputOptions(command), {
      ...record,
      resolvedPolicy: resolvePolicyConfig({
        agentId: record.name,
        overrides: record.policyOverrides,
        presetName: record.policyPreset ?? DEFAULT_POLICY_PRESET
      }),
      walletPublicKey: wallet?.publicKey ?? "<missing>"
    }, `Agent ${record.name}`);
  });

agent
  .command("run")
  .requiredOption("--agent <name>", "agent name")
  .requiredOption("--strategy <strategy>", "strategy name")
  .description("run a single agent once")
  .action(async (options, command: Command) => {
    const record = resolveAgentRecord(options.agent);
    const updated = agentRegistry.patch(record.name, {
      status: "active",
      strategy: options.strategy
    });
    const result = await runAgentOnce({
      agent: updated,
      overrideStrategy: options.strategy
    });
    const lastSignature = result.outcomes.find((entry) => entry.signature)?.signature;
    agentRegistry.patch(updated.name, {
      lastAction: `${options.strategy}:run-once`,
      lastRunAtIso: new Date().toISOString(),
      lastSignature: lastSignature ?? undefined,
      status: "active"
    });
    activity("agent", {
      action: "run",
      outcomes: result.outcomes.length,
      strategy: options.strategy
    }, { agent: updated.name, signature: lastSignature ?? undefined });
    printResult(outputOptions(command), {
      ...result,
      explorer: lastSignature ? txExplorer(lastSignature) : null
    }, `Agent ${updated.name} run complete`);
  });

agent
  .command("run-all")
  .description("run all active agents once")
  .action(async (_, command: Command) => {
    const records = agentRegistry.synchronizeWithWallets().filter((entry) => entry.status === "active");
    const results = [];
    for (const record of records) {
      try {
        const result = await runAgentOnce({ agent: record });
        const lastSignature = result.outcomes.find((entry) => entry.signature)?.signature;
        agentRegistry.patch(record.name, {
          lastAction: `${record.strategy}:run-once`,
          lastRunAtIso: new Date().toISOString(),
          lastSignature: lastSignature ?? undefined
        });
        results.push({
          agent: record.name,
          outcomes: result.outcomes.length,
          signature: lastSignature ?? "-"
        });
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : "unknown error";
        agentRegistry.patch(record.name, {
          lastError: reason,
          lastRunAtIso: new Date().toISOString()
        });
        results.push({
          agent: record.name,
          error: reason,
          outcomes: 0,
          signature: "-"
        });
      }
    }
    activity("agent", { action: "run-all", count: results.length });
    printResult(outputOptions(command), results, "Run-all summary");
  });

agent
  .command("stop")
  .requiredOption("--agent <name>", "agent name")
  .description("mark agent as stopped")
  .action((options, command: Command) => {
    const updated = agentRegistry.patch(options.agent, { status: "stopped" });
    activity("agent", { action: "stop" }, { agent: options.agent });
    printResult(outputOptions(command), updated, `Agent ${options.agent} stopped`);
  });

agent
  .command("logs")
  .requiredOption("--agent <name>", "agent name")
  .description("show recent activity logs for agent")
  .action((options, command: Command) => {
    const logs = activityStore.listByAgent(options.agent, 100).map((entry) => ({
      details: JSON.stringify(entry.details),
      kind: entry.kind,
      signature: entry.signature ?? "-",
      timestamp: entry.createdAtIso
    }));
    printResult(outputOptions(command), logs, `Recent logs for ${options.agent}`);
  });

const monitor = program.command("monitor").description("operational monitoring views");

monitor
  .command("overview")
  .description("summarize agents, wallets and last activity")
  .action(async (_, command: Command) => {
    const rows = await buildOverviewRows();
    activity("monitor", { action: "overview", rows: rows.length });
    printResult(outputOptions(command), rows, "Monitor overview");
  });

monitor
  .command("watch")
  .description("live-refresh monitor overview")
  .option("--interval <seconds>", "refresh interval in seconds", "5")
  .option("--iterations <n>", "stop after n refreshes", "0")
  .action(async (options, command: Command) => {
    const intervalSeconds = Number(options.interval);
    const iterations = Number(options.iterations);
    if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
      throw new Error("--interval must be a positive number");
    }
    const json = outputOptions(command).json;
    let count = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      count += 1;
      const rows = await buildOverviewRows();
      const snapshot = {
        iteration: count,
        timestamp: new Date().toISOString(),
        rows
      };
      if (json) {
        console.log(JSON.stringify(snapshot, null, 2));
      } else {
        console.clear();
        console.log(`PRKT monitor watch | ${snapshot.timestamp} | iteration ${count}`);
        if (rows.length === 0) {
          console.log("No agents found.");
        } else {
          console.table(rows);
        }
      }
      activity("monitor", { action: "watch", iteration: count, rows: rows.length });
      if (iterations > 0 && count >= iterations) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.round(intervalSeconds * 1000)));
    }
  });

monitor
  .command("balances")
  .description("show wallet SOL balances")
  .action(async (_, command: Command) => {
    const { balanceService } = await buildServices();
    const rows = [];
    for (const wallet of walletRegistry.list()) {
      const sol = await balanceService.getSolBalance(new PublicKey(wallet.publicKey));
      rows.push({
        name: wallet.name,
        publicKey: wallet.publicKey,
        sol: sol.toFixed(4)
      });
    }
    printResult(outputOptions(command), rows, "Wallet balances");
  });

monitor
  .command("txs")
  .description("show recent transaction activity")
  .action((_, command: Command) => {
    const txs = activityStore
      .list(100)
      .filter((entry) => Boolean(entry.signature))
      .map((entry) => ({
        agent: entry.agent ?? "-",
        kind: entry.kind,
        signature: entry.signature,
        timestamp: entry.createdAtIso
      }));
    printResult(outputOptions(command), txs, "Recent transactions");
  });

monitor
  .command("agents")
  .description("show agent runtime state")
  .action((_, command: Command) => {
    const rows = agentRegistry.synchronizeWithWallets().map((entry) => ({
      agent: entry.name,
      lastError: entry.lastError ?? "-",
      lastRunAt: entry.lastRunAtIso ?? "-",
      policyMode: entry.policyMode,
      status: entry.status,
      strategy: entry.strategy
    }));
    printResult(outputOptions(command), rows, "Agent state");
  });

const demo = program.command("demo").description("demo execution helpers");
demo
  .command("multi-agent-devnet")
  .description("run existing multi-agent devnet demo")
  .action(async (_, command: Command) => {
    const result = await runMultiAgentDevnetScenario();
    activity("demo", {
      action: "multi-agent-devnet",
      mintAddress: result.mintAddress,
      signatures: result.signatures.length
    });
    printResult(outputOptions(command), {
      ...result,
      explorerLinks: result.signatures.map(txExplorer)
    }, "Multi-agent devnet demo complete");
  });

program
  .command("audit")
  .description("show recent audit log entries")
  .option("--limit <n>", "max entries", "100")
  .action((options, command: Command) => {
    const limit = Number(options.limit);
    const rows = activityStore.list(Number.isFinite(limit) ? limit : 100).map((entry) => ({
      agent: entry.agent ?? "-",
      details: JSON.stringify(entry.details),
      kind: entry.kind,
      signature: entry.signature ?? "-",
      timestamp: entry.createdAtIso
    }));
    printResult(outputOptions(command), rows, "Audit activity");
  });

const config = program.command("config").description("configuration commands");
config
  .command("show")
  .description("show runtime config")
  .action((_, command: Command) => {
    const rpc = getRpcUrl();
    const dataDirStatus = probeCliDataDir();
    const payload = {
      cliDataDir: dataDirStatus.path,
      cliDataDirHealth: dataDirStatus.details,
      cliDataDirWritable: dataDirStatus.writable,
      cluster: detectClusterFromRpcUrl(rpc),
      custodyModel: CUSTODY_MODEL,
      koraRpc: getKoraRpcUrl(),
      liveRaydiumLp: isLiveRaydiumLpEnabled(),
      liveSwap: isLiveSwapPathEnabled(),
      policyExecutionModel: POLICY_EXECUTION_MODEL,
      rpc,
      walletKeySource: getPlatformMasterKeySource(),
      universalDefiLiveFirst: isUniversalDeFiLiveFirstEnabled(),
      usdcMint: getUsdcMintAddress()
    };
    activity("config", { action: "show" });
    printResult(outputOptions(command), payload, "Config");
  });

program
  .command("doctor")
  .description("validate env, rpc, and devnet readiness")
  .action(async (_, command: Command) => {
    const checks: Array<{ check: string; status: "ok" | "warn" | "fail"; details: string }> = [];
    const rpc = getRpcUrl();
    const dataDirStatus = probeCliDataDir();
    checks.push({
      check: "cluster",
      details: detectClusterFromRpcUrl(rpc),
      status: detectClusterFromRpcUrl(rpc) === "devnet" ? "ok" : "warn"
    });
    try {
      const rpcClient = new RpcClient(rpc, "confirmed");
      await rpcClient.getLatestBlockhash("confirmed");
      checks.push({
        check: "rpc-connectivity",
        details: rpc,
        status: "ok"
      });
    } catch (error: unknown) {
      checks.push({
        check: "rpc-connectivity",
        details: error instanceof Error ? error.message : "unknown rpc error",
        status: "fail"
      });
    }

    const signerCheck = inspectSignerConfiguration();
    checks.push({
      check: "treasury-key",
      details: signerCheck.detail,
      status: signerCheck.status
    });
    checks.push({
      check: "custody-model",
      details: CUSTODY_MODEL,
      status: "ok"
    });
    checks.push({
      check: "cli-data-dir",
      details: dataDirStatus.path,
      status: "ok"
    });
    checks.push({
      check: "cli-data-dir-writable",
      details: dataDirStatus.details,
      status: dataDirStatus.writable ? "ok" : "fail"
    });
    checks.push({
      check: "wallet-key-source",
      details: getPlatformMasterKeySource(),
      status: "ok"
    });
    checks.push({
      check: "policy-execution-model",
      details: POLICY_EXECUTION_MODEL,
      status: "ok"
    });
    checks.push({
      check: "live-swap-flag",
      details: String(isLiveSwapPathEnabled()),
      status: "ok"
    });
    checks.push({
      check: "live-raydium-flag",
      details: String(isLiveRaydiumLpEnabled()),
      status: "ok"
    });
    checks.push({
      check: "universal-live-first",
      details: String(isUniversalDeFiLiveFirstEnabled()),
      status: "ok"
    });

    activity("doctor", { checks: checks.length });
    printResult(outputOptions(command), checks, "Doctor checks");
  });

program
  .command("completion")
  .description("print shell completion script")
  .argument("[shell]", "shell type: bash | zsh | powershell", "bash")
  .action((shell: string) => {
    const normalized = shell.trim().toLowerCase();
    if (normalized === "bash") {
      console.log(buildBashCompletion());
      return;
    }
    if (normalized === "zsh") {
      console.log(buildZshCompletion());
      return;
    }
    if (normalized === "powershell" || normalized === "pwsh") {
      console.log(buildPowerShellCompletion());
      return;
    }
    throw new Error("Unsupported shell. Use: bash, zsh, powershell");
  });

async function main(): Promise<void> {
  try {
    if (shouldPrintStartupBanner(process.argv.slice(2))) {
      console.log(`${CLI_BANNER}\n`);
    }

    await program.parseAsync(process.argv);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown CLI error";
    console.error(`CLI error: ${message}`);
    process.exitCode = 1;
  }
}

main();
