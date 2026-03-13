import type { PublicKey } from "@solana/web3.js";

import type { BalanceService } from "../../core/balances/BalanceService";
import type { RpcClient } from "../../core/rpc/RpcClient";
import type { TokenService } from "../../core/tokens/TokenService";
import type { TransactionService } from "../../core/transactions/TransactionService";
import type { WalletManager } from "../../core/wallet/WalletManager";
import type { PolicyConfig } from "../../policy";
import type { AgentIntent } from "../intents/types";
import type {
  UniversalDeFiRequest,
  UniversalExecutionOptions,
  UniversalExecutionResult
} from "../../defi/universal";

export type AgentLogger = (message: string) => void;

export type AgentContext = {
  id: string;
  walletManager: WalletManager;
  walletPublicKey: PublicKey;
  rpcClient: RpcClient;
  transactionService: TransactionService;
  tokenService: TokenService;
  balanceService: BalanceService;
  policyConfig: PolicyConfig;
  logger: AgentLogger;
  universalDeFiExecutor?: {
    execute(request: UniversalDeFiRequest, options?: UniversalExecutionOptions): Promise<UniversalExecutionResult>;
  };
};

export type Strategy = {
  name: string;
  nextIntents(context: AgentContext): Promise<AgentIntent[]>;
};
