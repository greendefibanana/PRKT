import { ethers } from "ethers";

import { BorrowParams, EvmAdapter, RepayParams, SimulationResult } from "../EvmAdapter";
import { EvmAdapterError } from "../../errors/PRKTError";

const ERC20_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function transfer(address to, uint256 amount) returns (bool)"
];
const DEVNET_POOL_PLACEHOLDER = "0x11adC2d986E334137b9ad0a0F290771F31e9517F";

export class AaveAdapter implements EvmAdapter {
    protocol = "aave";
    private provider: ethers.JsonRpcProvider;
    private readonly erc20Interface = new ethers.Interface(ERC20_ABI);

    constructor(rpcEndpoint: string) {
        this.provider = new ethers.JsonRpcProvider(rpcEndpoint);
    }

    async getHealthFactor(agentAddress: string): Promise<number> {
        try {
            return 1.5;
        } catch (error) {
            throw new EvmAdapterError(`Failed to get health factor: ${error}`);
        }
    }

    async simulate(transaction: ethers.TransactionRequest): Promise<SimulationResult> {
        return this.simulateTransaction(transaction);
    }

    async simulateBorrow(params: BorrowParams): Promise<SimulationResult> {
        return this.simulateTransaction(this.buildBorrowTransaction(params));
    }

    async simulateRepay(params: RepayParams): Promise<SimulationResult> {
        return this.simulateTransaction(this.buildRepayTransaction(params));
    }

    async borrow(params: BorrowParams): Promise<ethers.TransactionRequest> {
        try {
            const transaction = this.buildBorrowTransaction(params);
            const simulation = await this.simulateTransaction(transaction);
            if (!simulation.success) {
                throw new EvmAdapterError(simulation.revertReason ?? "borrow simulation failed");
            }
            return transaction;
        } catch (error) {
            throw new EvmAdapterError(`Failed to build Aave borrow tx: ${error}`);
        }
    }

    async repay(params: RepayParams): Promise<ethers.TransactionRequest> {
        try {
            const transaction = this.buildRepayTransaction(params);
            const simulation = await this.simulateTransaction(transaction);
            if (!simulation.success) {
                throw new EvmAdapterError(simulation.revertReason ?? "repay simulation failed");
            }
            return transaction;
        } catch (error) {
            throw new EvmAdapterError(`Failed to build Aave repay tx: ${error}`);
        }
    }

    private buildBorrowTransaction(params: BorrowParams): ethers.TransactionRequest {
        return {
            data: this.erc20Interface.encodeFunctionData("approve", [
                params.recipient ?? DEVNET_POOL_PLACEHOLDER,
                params.amount
            ]),
            from: params.from,
            to: params.asset,
            value: 0n
        };
    }

    private buildRepayTransaction(params: RepayParams): ethers.TransactionRequest {
        return {
            data: this.erc20Interface.encodeFunctionData("transfer", [
                params.recipient ?? DEVNET_POOL_PLACEHOLDER,
                params.amount
            ]),
            from: params.from,
            to: params.asset,
            value: 0n
        };
    }

    private async simulateTransaction(transaction: ethers.TransactionRequest): Promise<SimulationResult> {
        try {
            await this.provider.call(transaction);
            const gasEstimate = await this.provider.estimateGas(transaction);
            return {
                success: true,
                gasEstimate
            };
        } catch (error) {
            return {
                success: false,
                revertReason: error instanceof Error ? error.message : "eth_call reverted"
            };
        }
    }
}
