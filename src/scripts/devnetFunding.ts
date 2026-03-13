import { BalanceService } from "../core/balances/BalanceService";
import { DevnetFundingService } from "../core/funding/DevnetFundingService";
import { WalletManager } from "../wallet/WalletManager";

const SOL_BALANCE_TOLERANCE = 0.000001;

export async function ensureWalletHasMinimumSol(input: {
  balanceService: BalanceService;
  fundingService: DevnetFundingService;
  minimumSol: number;
  publicKey: WalletManager["publicKey"];
}): Promise<void> {
  const funding = await input.fundingService.ensureMinimumSol({
    balanceService: input.balanceService,
    minimumSol: input.minimumSol,
    recipient: input.publicKey
  });
  if (!funding) {
    return;
  }

  const updatedBalance = await input.fundingService.waitForMinimumBalance({
    balanceService: input.balanceService,
    minimumSol: input.minimumSol,
    recipient: input.publicKey
  });
  if (updatedBalance + SOL_BALANCE_TOLERANCE >= input.minimumSol) {
    console.log(`Funding source: ${funding.source}`);
    console.log(`Funding signature: ${funding.signature}`);
    console.log(`SOL after funding: ${updatedBalance.toFixed(4)}`);
    return;
  }

  const finalBalance = await input.balanceService.getSolBalance(input.publicKey);
  throw new Error(
    `Funding failed: wallet balance is ${finalBalance.toFixed(4)} SOL after ${funding.source}, below required ${input.minimumSol.toFixed(4)} SOL.`
  );
}
