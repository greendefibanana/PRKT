import { createDefaultAgentPolicy } from "../agent/policyFactory";
import type { PolicyConstraints, SupportedProtocol } from "../types/policy";
import { KoraSigner } from "../kora/KoraSigner";
import { WalletManager } from "../wallet/WalletManager";
import { DeFiExecutor } from "./DeFiExecutor";
import { KaminoAdapter } from "./adapters/KaminoAdapter";
import { JupiterAdapter } from "./adapters/JupiterAdapter";
import { MarinadeAdapter } from "./adapters/MarinadeAdapter";
import { RaydiumAdapter } from "./adapters/RaydiumAdapter";
import { PROTOCOL_PRESETS } from "./protocols";
import type { DeFiExecutionResult, DeFiIntent, MarketSnapshot } from "./types";

type StrategyLogger = (message: string) => void;

export class DeFiCoordinator {
  private readonly kaminoAdapter = new KaminoAdapter();
  private readonly jupiterAdapter = new JupiterAdapter();
  private readonly marinadeAdapter = new MarinadeAdapter();
  private readonly raydiumAdapter = new RaydiumAdapter();

  constructor(
    private readonly walletManager: WalletManager,
    private readonly koraSigner: KoraSigner,
    private readonly logger: StrategyLogger = () => undefined,
    private readonly policy: PolicyConstraints = createDefaultAgentPolicy({
      maxSpend: {
        lamports: 2_000_000
      }
    })
  ) {}

  async runStakingStrategy(snapshot: MarketSnapshot): Promise<DeFiExecutionResult | null> {
    const intent = this.marinadeAdapter.buildStakeIntent(snapshot);
    if (!intent) {
      this.logger("Staking strategy -> HOLD (Marinade adapter found insufficient idle SOL).");
      return null;
    }

    return this.execute(intent);
  }

  async runLiquidityStrategy(snapshot: MarketSnapshot): Promise<DeFiExecutionResult | null> {
    const intent = this.raydiumAdapter.buildAddLiquidityIntent(snapshot);
    if (!intent) {
      this.logger("LP strategy -> HOLD (Raydium adapter found pool pricing out of range).");
      return null;
    }

    return this.execute(intent);
  }

  async runLendingStrategy(snapshot: MarketSnapshot): Promise<DeFiExecutionResult | null> {
    const intent = this.kaminoAdapter.buildDepositIntent(snapshot);
    if (!intent) {
      this.logger("Lending strategy -> HOLD (Kamino adapter found insufficient idle USDC).");
      return null;
    }

    return this.execute(intent);
  }

  async runBorrowingStrategy(snapshot: MarketSnapshot): Promise<DeFiExecutionResult | null> {
    const intent = this.kaminoAdapter.buildBorrowIntent(snapshot);
    if (!intent) {
      this.logger("Borrowing strategy -> HOLD (Kamino adapter found insufficient collateral or borrow demand).");
      return null;
    }

    return this.execute(intent);
  }

  async runTradeStrategy(snapshot: MarketSnapshot): Promise<DeFiExecutionResult | null> {
    const intent = this.jupiterAdapter.buildTradeIntent(snapshot);
    if (!intent) {
      this.logger("Trade strategy -> HOLD (Jupiter adapter found no favorable setup).");
      return null;
    }

    return this.execute(intent);
  }

  async runFullSuite(snapshot: MarketSnapshot): Promise<DeFiExecutionResult[]> {
    const results = await Promise.all([
      this.runTradeStrategy(snapshot),
      this.runStakingStrategy(snapshot),
      this.runLiquidityStrategy(snapshot),
      this.runLendingStrategy(snapshot),
      this.runBorrowingStrategy(snapshot)
    ]);

    return results.filter((result): result is DeFiExecutionResult => result !== null);
  }

  private async execute(intent: DeFiIntent): Promise<DeFiExecutionResult> {
    const preset = PROTOCOL_PRESETS[intent.protocol as SupportedProtocol];
    this.logger(
      `${preset.label} strategy -> Policy Check -> Gasless Execution (${intent.action} on ${intent.marketId}).`
    );

    const executor = new DeFiExecutor(this.policy);
    const result = await executor.executeIntent({
      intent,
      koraSigner: this.koraSigner,
      walletManager: this.walletManager
    });

    this.logger(
      `${preset.label} strategy -> Executed ${result.mock ? "mock " : ""}${result.action} ${result.signature}`
    );

    return result;
  }
}
