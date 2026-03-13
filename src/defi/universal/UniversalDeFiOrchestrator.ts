import { createDefaultAgentPolicy } from "../../agent/policyFactory";
import { isNeonBroadcastEnabled, isUniversalDeFiLiveFirstEnabled } from "../../config/env";
import type { KoraSigner } from "../../kora/KoraSigner";
import type { WalletManager } from "../../wallet/WalletManager";
import type { PolicyConstraints } from "../../types/policy";
import type { DeFiExecutionResult } from "../types";
import { DeFiExecutor } from "../DeFiExecutor";
import {
  JupiterUniversalAdapter,
  KaminoUniversalAdapter,
  MarinadeUniversalAdapter,
  RaydiumUniversalAdapter
} from "./adapters";
import {
  prepareLiveJupiter,
  prepareLiveKamino,
  prepareLiveMarinade,
  prepareLiveRaydiumLp
} from "./liveExecutors";
import type {
  PreparedLiveExecution,
  UniversalDeFiAdapter,
  UniversalExecutionOptions,
  UniversalDeFiRequest,
  UniversalExecutionResult
} from "./types";
import { defaultPRKTConfig } from "../../config/PRKTConfig";
import { NeonWalletBridge } from "../../evm/NeonWalletBridge";
import { UniswapV3Adapter } from "../../evm/adapters/UniswapV3Adapter";
import { AaveAdapter } from "../../evm/adapters/AaveAdapter";
import { ethers } from "ethers";

type OrchestratorLogger = (message: string) => void;
const DEVNET_NEON_USDC = "0x512E48836Cd42F3eB6f50CEd9ffD81E0a7F15103";
const DEVNET_NEON_WSOL = "0xc7Fc9b46e479c5Cb42f6C458D1881e55E6B7986c";

export class UniversalDeFiOrchestrator {
  private readonly adapters: UniversalDeFiAdapter[];
  private readonly executor: DeFiExecutor;

  constructor(
    private readonly deps: {
      koraSigner: KoraSigner;
      liveFirst?: boolean;
      logger?: OrchestratorLogger;
      policy?: PolicyConstraints;
      walletManager: WalletManager;
    },
    adapters?: UniversalDeFiAdapter[]
  ) {
    this.adapters = adapters ?? [
      new JupiterUniversalAdapter(),
      new MarinadeUniversalAdapter(),
      new RaydiumUniversalAdapter(),
      new KaminoUniversalAdapter()
    ];
    this.executor = new DeFiExecutor(
      deps.policy ??
      createDefaultAgentPolicy({
        maxSpend: {
          lamports: 2_000_000_000
        }
      })
    );
  }

  async execute(
    request: UniversalDeFiRequest,
    options?: UniversalExecutionOptions
  ): Promise<UniversalExecutionResult> {
    if (defaultPRKTConfig.evmAdapters.enabled) {
      if ((request.protocol as any) === "uniswap-v3" || (request.protocol as any) === "aave") {
        return this.routeToEvm(request, options);
      }
    }

    const adapter = this.resolveAdapter(request);
    if (!adapter) {
      this.log(
        `No compatible adapter for capability=${request.capability} protocol=${request.protocol ?? "auto"}`
      );
      return {
        capability: request.capability,
        protocol: request.protocol ?? "raydium",
        result: null
      };
    }

    const intent = adapter.buildIntent(request);
    if (!intent) {
      this.log(`${adapter.protocol} returned HOLD for capability ${request.capability}`);
      return {
        capability: request.capability,
        protocol: adapter.protocol,
        result: null
      };
    }

    const liveFirst = this.deps.liveFirst ?? isUniversalDeFiLiveFirstEnabled();
    if (liveFirst) {
      const preparedLive =
        (await prepareLiveJupiter({
          intent,
          logger: this.deps.logger,
          walletManager: this.deps.walletManager
        })) ??
        (await prepareLiveRaydiumLp({
          intent,
          logger: this.deps.logger,
          walletManager: this.deps.walletManager
        })) ??
        (await prepareLiveKamino({
          intent,
          logger: this.deps.logger,
          walletManager: this.deps.walletManager
        })) ??
        (await prepareLiveMarinade({
          intent,
          logger: this.deps.logger,
          walletManager: this.deps.walletManager
        }));

      const liveResult = await this.tryExecutePreparedLive(preparedLive, options);
      if (liveResult) {
        return {
          capability: request.capability,
          protocol: adapter.protocol,
          result: liveResult
        };
      }
    }

    const result = await this.executor.executeIntent({
      intent,
      koraSigner: this.deps.koraSigner,
      walletManager: this.deps.walletManager
    });

    return {
      capability: request.capability,
      protocol: adapter.protocol,
      result
    };
  }

  async executeBatch(
    requests: UniversalDeFiRequest[],
    options?: UniversalExecutionOptions
  ): Promise<UniversalExecutionResult[]> {
    return Promise.all(requests.map((request) => this.execute(request, options)));
  }

  private resolveAdapter(request: UniversalDeFiRequest): UniversalDeFiAdapter | null {
    const scoped = request.protocol
      ? this.adapters.filter((adapter) => adapter.protocol === request.protocol)
      : this.adapters;

    return scoped.find((adapter) => adapter.capabilities.includes(request.capability)) ?? null;
  }

  private log(message: string): void {
    (this.deps.logger ?? (() => undefined))(message);
  }

  private async tryExecutePreparedLive(
    prepared: PreparedLiveExecution | null,
    options?: UniversalExecutionOptions
  ): Promise<DeFiExecutionResult | null> {
    if (!prepared) {
      return null;
    }

    if (!options?.liveExecutor) {
      this.log(`guarded live ${prepared.protocol} transaction prepared but no guarded executor was provided`);
      return null;
    }

    const execution = await options.liveExecutor.executePreparedTransaction({
      confirmationStrategy: prepared.confirmationStrategy,
      inspectionContext: prepared.inspectionContext,
      policyConfigPatch: prepared.policyConfigPatch,
      transaction: prepared.transaction
    });
    if (!execution.signature) {
      const reasons = execution.inspection.reasons.join("; ");
      this.log(`guarded live ${prepared.protocol} execution blocked${reasons ? `: ${reasons}` : ""}`);
      return null;
    }

    if (prepared.verifyExecution) {
      await prepared.verifyExecution(execution.signature);
    }

    return prepared.toExecutionResult(execution.signature);
  }

  private async routeToEvm(
    request: UniversalDeFiRequest,
    options?: UniversalExecutionOptions
  ): Promise<UniversalExecutionResult> {
    const protocol = String(request.protocol ?? "unknown");

    if (!options?.liveExecutor) {
      this.log(`guarded EVM ${protocol} execution requested but no executor was provided`);
      return {
        capability: request.capability,
        protocol: request.protocol ?? ("unknown" as any),
        result: null
      };
    }

    if (!isNeonBroadcastEnabled()) {
      this.log(`EVM routing for ${protocol} skipped because NEON_BROADCAST_ENABLED is false`);
      return {
        capability: request.capability,
        protocol: request.protocol ?? ("unknown" as any),
        result: null
      };
    }

    const neonRpcEndpoint = defaultPRKTConfig.evmAdapters.neonRpcEndpoint;
    const bridge = new NeonWalletBridge(neonRpcEndpoint);
    if (this.deps.walletManager.source === "remote") {
      this.log(`EVM routing for ${protocol} requires a local Solana keypair; remote signer wallets are not supported`);
      return {
        capability: request.capability,
        protocol: request.protocol ?? ("unknown" as any),
        result: null
      };
    }

    const solanaKeypair = this.deps.walletManager.payer;
    const evmAddress = bridge.deriveEvmAddress(solanaKeypair);
    let tx: ethers.TransactionRequest | null = null;
    const params = (request as any).params ?? {};

    if ((request.protocol as any) === "uniswap-v3" && ((request.capability as any) === "SWAP" || request.capability === "trade")) {
      const uniswap = new UniswapV3Adapter(neonRpcEndpoint);
      const amount = normalizeBigInt(params.amount);
      if (amount === null || amount <= 0n) {
        this.log("EVM uniswap-v3 routing requires params.amount > 0");
        return {
          capability: request.capability,
          protocol: request.protocol ?? ("unknown" as any),
          result: null
        };
      }

      tx = await uniswap.swap({
        amount,
        from: evmAddress,
        recipient: normalizeAddress(params.recipient),
        slippage: normalizeNumber(params.slippage, 1),
        tokenIn: normalizeAddress(params.tokenIn) ?? DEVNET_NEON_USDC,
        tokenOut: normalizeAddress(params.tokenOut) ?? DEVNET_NEON_WSOL
      });
    } else if ((request.protocol as any) === "aave" && ((request.capability as any) === "BORROW" || request.capability === "borrowing")) {
      const aave = new AaveAdapter(neonRpcEndpoint);
      const amount = normalizeBigInt(params.amount);
      const asset = normalizeAddress(params.asset);
      if (amount === null || amount <= 0n || !asset) {
        this.log("EVM aave routing requires params.asset and params.amount > 0");
        return {
          capability: request.capability,
          protocol: request.protocol ?? ("unknown" as any),
          result: null
        };
      }

      tx = await aave.borrow({
        amount,
        asset,
        from: evmAddress,
        interestRateMode: normalizeNumber(params.interestRateMode, 2),
        recipient: normalizeAddress(params.recipient)
      });
    }

    if (!tx) {
      this.log(`No EVM builder available for capability=${request.capability} protocol=${protocol}`);
      return {
        capability: request.capability,
        protocol: request.protocol ?? ("unknown" as any),
        result: null
      };
    }

    try {
      const execution = await (options.liveExecutor as any).executePreparedEvmTransaction({
        address: evmAddress,
        solanaKeypair,
        transaction: tx,
      });
      if (!execution.signature) {
        this.log(`EVM ${protocol} execution blocked${execution.reason ? `: ${execution.reason}` : ""}`);
        return {
          capability: request.capability,
          protocol: request.protocol ?? ("unknown" as any),
          result: null
        };
      }

      return {
        capability: request.capability,
        protocol: request.protocol ?? ("unknown" as any),
        result: {
          action: "EVM_EXECUTION" as any,
          memo: `Executed EVM transaction for ${request.protocol}`,
          mock: false,
          protocol: request.protocol as any,
          signature: execution.signature
        }
      };
    } catch (error) {
      this.log(`EVM Sandbox execution failed: ${error}`);
      return {
        capability: request.capability,
        protocol: request.protocol ?? ("unknown" as any),
        result: null
      };
    }
  }
}

function normalizeAddress(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return BigInt(value.trim());
  }

  return null;
}

function normalizeNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}
