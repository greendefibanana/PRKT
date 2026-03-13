import { PublicKey } from "@solana/web3.js";

import { RpcClient } from "../rpc/RpcClient";
import { TokenService } from "../tokens/TokenService";

const LAMPORTS_PER_SOL = 1_000_000_000;

export class BalanceService {
  constructor(
    private readonly rpcClient: RpcClient,
    private readonly tokenService: TokenService
  ) {}

  async getSolBalanceLamports(owner: PublicKey): Promise<number> {
    return this.rpcClient.getBalance(owner, "confirmed");
  }

  async getSolBalance(owner: PublicKey): Promise<number> {
    const lamports = await this.getSolBalanceLamports(owner);
    return lamports / LAMPORTS_PER_SOL;
  }

  async getSplTokenBalance(input: {
    owner: PublicKey;
    mint: PublicKey;
  }): Promise<number> {
    const ata = this.tokenService.findAssociatedTokenAddress(input.owner, input.mint);
    const account = await this.rpcClient.getAccountInfo(ata, "confirmed");
    if (!account) {
      return 0;
    }

    const tokenBalance = await this.rpcClient.getTokenAccountBalance(ata, "confirmed");
    if (tokenBalance.value.uiAmount !== null && tokenBalance.value.uiAmount !== undefined) {
      return tokenBalance.value.uiAmount;
    }

    const decimals = tokenBalance.value.decimals;
    const raw = Number(tokenBalance.value.amount);
    return raw / 10 ** decimals;
  }
}
