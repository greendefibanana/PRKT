import { ethers } from "ethers";

export interface SwapParams {
    tokenIn: string;
    tokenOut: string;
    amount: bigint;
    from?: string;
    recipient?: string;
    simulationMode?: "approval" | "transfer";
    slippage: number;
}

export interface LPParams {
    tokenA: string;
    tokenB: string;
    amountA: bigint;
    amountB: bigint;
}

export interface BorrowParams {
    asset: string;
    amount: bigint;
    from?: string;
    recipient?: string;
    interestRateMode: number;
}

export interface RepayParams {
    asset: string;
    amount: bigint;
    from?: string;
    recipient?: string;
}

export interface SimulationResult {
    success: boolean;
    gasEstimate?: bigint;
    revertReason?: string;
}

export interface EvmAdapter {
    protocol: string;
    simulate?(transaction: ethers.TransactionRequest): Promise<SimulationResult>;
    simulateBorrow?(params: BorrowParams): Promise<SimulationResult>;
    simulateRepay?(params: RepayParams): Promise<SimulationResult>;
    simulateSwap?(params: SwapParams): Promise<SimulationResult>;
    swap?(params: SwapParams): Promise<ethers.TransactionRequest>;
    addLiquidity?(params: LPParams): Promise<ethers.TransactionRequest>;
    borrow?(params: BorrowParams): Promise<ethers.TransactionRequest>;
    repay?(params: RepayParams): Promise<ethers.TransactionRequest>;
}
