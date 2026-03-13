import { PublicKey } from "@solana/web3.js";

import { RpcClient } from "../rpc/RpcClient";
import { TokenService } from "../tokens/TokenService";

const SOL_DECIMALS = 9;

export type BalanceSnapshot = {
  address: PublicKey;
  beforeRaw: bigint;
  decimals: number;
  kind: "sol" | "spl";
  label: string;
};

export type BalanceVerificationExpectation = {
  label?: string;
  maxDecreaseRaw?: bigint;
  minIncreaseRaw?: bigint;
  snapshot: BalanceSnapshot;
};

export type BalanceVerificationResult = {
  address: string;
  afterRaw: bigint;
  afterUi: string;
  beforeRaw: bigint;
  beforeUi: string;
  deltaRaw: bigint;
  deltaUi: string;
  kind: "sol" | "spl";
  label: string;
};

export class PostTransactionVerifier {
  constructor(
    private readonly rpcClient: RpcClient,
    private readonly tokenService: TokenService
  ) {}

  async snapshotSolBalance(owner: PublicKey, label = "SOL balance"): Promise<BalanceSnapshot> {
    const beforeLamports = await this.rpcClient.getBalance(owner, "confirmed");
    return {
      address: owner,
      beforeRaw: BigInt(beforeLamports),
      decimals: SOL_DECIMALS,
      kind: "sol",
      label
    };
  }

  async snapshotSplBalanceForOwner(input: {
    label?: string;
    mint: PublicKey;
    owner: PublicKey;
  }): Promise<BalanceSnapshot> {
    const tokenAccount = this.tokenService.findAssociatedTokenAddress(input.owner, input.mint);
    return this.snapshotSplTokenAccount({
      label: input.label ?? `Token balance for ${input.mint.toBase58()}`,
      mint: input.mint,
      tokenAccount
    });
  }

  async snapshotSplTokenAccount(input: {
    label?: string;
    mint: PublicKey;
    tokenAccount: PublicKey;
  }): Promise<BalanceSnapshot> {
    const decimals = await this.tokenService.getMintDecimals(input.mint);
    const beforeRaw = await this.getSplTokenBalanceRaw(input.tokenAccount);

    return {
      address: input.tokenAccount,
      beforeRaw,
      decimals,
      kind: "spl",
      label: input.label ?? `Token account ${input.tokenAccount.toBase58()}`
    };
  }

  async assertBalanceChanges(
    expectations: BalanceVerificationExpectation[]
  ): Promise<BalanceVerificationResult[]> {
    const reports = await Promise.all(
      expectations.map(async (expectation) => this.buildReport(expectation))
    );

    for (const [index, report] of reports.entries()) {
      const expectation = expectations[index];
      if (expectation.minIncreaseRaw !== undefined && report.deltaRaw < expectation.minIncreaseRaw) {
        throw new Error(
          `${report.label} verification failed: expected increase >= ${expectation.minIncreaseRaw.toString()} raw, got ${report.deltaRaw.toString()} raw (${report.beforeUi} -> ${report.afterUi}).`
        );
      }

      if (
        expectation.maxDecreaseRaw !== undefined &&
        report.deltaRaw < 0n &&
        -report.deltaRaw > expectation.maxDecreaseRaw
      ) {
        throw new Error(
          `${report.label} verification failed: expected decrease <= ${expectation.maxDecreaseRaw.toString()} raw, got ${(-report.deltaRaw).toString()} raw (${report.beforeUi} -> ${report.afterUi}).`
        );
      }
    }

    return reports;
  }

  private async buildReport(
    expectation: BalanceVerificationExpectation
  ): Promise<BalanceVerificationResult> {
    const afterRaw = await this.readCurrentRaw(expectation.snapshot);
    const deltaRaw = afterRaw - expectation.snapshot.beforeRaw;

    return {
      address: expectation.snapshot.address.toBase58(),
      afterRaw,
      afterUi: formatRawAmount(afterRaw, expectation.snapshot.decimals),
      beforeRaw: expectation.snapshot.beforeRaw,
      beforeUi: formatRawAmount(expectation.snapshot.beforeRaw, expectation.snapshot.decimals),
      deltaRaw,
      deltaUi: formatSignedRawAmount(deltaRaw, expectation.snapshot.decimals),
      kind: expectation.snapshot.kind,
      label: expectation.label ?? expectation.snapshot.label
    };
  }

  private async readCurrentRaw(snapshot: BalanceSnapshot): Promise<bigint> {
    if (snapshot.kind === "sol") {
      return BigInt(await this.rpcClient.getBalance(snapshot.address, "confirmed"));
    }

    return this.getSplTokenBalanceRaw(snapshot.address);
  }

  private async getSplTokenBalanceRaw(tokenAccount: PublicKey): Promise<bigint> {
    const account = await this.rpcClient.getAccountInfo(tokenAccount, "confirmed");
    if (!account) {
      return 0n;
    }

    const tokenBalance = await this.rpcClient.getTokenAccountBalance(tokenAccount, "confirmed");
    return BigInt(tokenBalance.value.amount);
  }
}

function formatSignedRawAmount(raw: bigint, decimals: number): string {
  const sign = raw < 0n ? "-" : "+";
  const absolute = raw < 0n ? -raw : raw;
  return `${sign}${formatRawAmount(absolute, decimals)}`;
}

function formatRawAmount(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const absolute = negative ? -raw : raw;
  const divisor = 10n ** BigInt(decimals);
  const whole = absolute / divisor;
  const fraction = absolute % divisor;

  if (fraction === 0n) {
    return `${negative ? "-" : ""}${whole.toString()}`;
  }

  const fractionString = fraction.toString().padStart(decimals, "0").replace(/0+$/u, "");
  return `${negative ? "-" : ""}${whole.toString()}.${fractionString}`;
}
