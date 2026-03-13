import { ethers } from "ethers";

import { EvmAdapter, SimulationResult, SwapParams } from "../EvmAdapter";
import { EvmAdapterError } from "../../errors/PRKTError";

const CHAINLINK_AGGREGATOR_ABI = [
    "function decimals() view returns (uint8)",
    "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"
];
const ERC20_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function decimals() view returns (uint8)",
    "function transfer(address to, uint256 amount) returns (bool)"
];
const DEVNET_CHAINLINK_FEEDS = {
    "sol-usd": "0xec852B2A009f49E4eE4ffEddeDcF81a1AD1bbD6d",
    "usdc-usd": "0xedc0d80E85292fEf5B0946DEc957563Ceb7C8e6c"
} as const;
const DEVNET_NEON_TOKENS = {
    usdc: "0x512E48836Cd42F3eB6f50CEd9ffD81E0a7F15103",
    wsol: "0xc7Fc9b46e479c5Cb42f6C458D1881e55E6B7986c"
} as const;

export class UniswapV3Adapter implements EvmAdapter {
    protocol = "uniswap-v3";
    private provider: ethers.JsonRpcProvider;
    private readonly aggregatorInterface = new ethers.Interface(CHAINLINK_AGGREGATOR_ABI);
    private readonly erc20Interface = new ethers.Interface(ERC20_ABI);

    constructor(rpcEndpoint: string) {
        this.provider = new ethers.JsonRpcProvider(rpcEndpoint);
    }

    async getQuote(tokenIn: string, tokenOut: string, amount: bigint): Promise<bigint> {
        try {
            const [tokenInDecimals, tokenOutDecimals] = await Promise.all([
                this.readErc20Decimals(tokenIn),
                this.readErc20Decimals(tokenOut)
            ]);
            const [priceIn, priceOut] = await Promise.all([
                this.readPrice(this.resolveFeed(tokenIn)),
                this.readPrice(this.resolveFeed(tokenOut))
            ]);

            return (
                amount *
                priceIn.price *
                10n ** BigInt(tokenOutDecimals)
            ) / (
                10n ** BigInt(tokenInDecimals) *
                priceOut.price
            );
        } catch (error) {
            throw new EvmAdapterError(`Failed to get Uniswap V3 quote: ${error}`);
        }
    }

    async simulate(transaction: ethers.TransactionRequest): Promise<SimulationResult> {
        return this.simulateTransaction(transaction);
    }

    async simulateSwap(params: SwapParams): Promise<SimulationResult> {
        const transaction = await this.buildSwapTransaction(params);
        return this.simulateTransaction(transaction);
    }

    async swap(params: SwapParams): Promise<ethers.TransactionRequest> {
        try {
            const minAmountOut = await this.getQuote(params.tokenIn, params.tokenOut, params.amount);
            const minimum = minAmountOut * BigInt(100 - params.slippage) / 100n;
            const transaction = await this.buildSwapTransaction({
                ...params,
                amount: minimum
            });
            const simulation = await this.simulateTransaction(transaction);
            if (!simulation.success) {
                throw new EvmAdapterError(simulation.revertReason ?? "swap simulation failed");
            }
            return transaction;
        } catch (error) {
            throw new EvmAdapterError(`Failed to build Uniswap V3 swap tx: ${error}`);
        }
    }

    private async buildSwapTransaction(params: SwapParams): Promise<ethers.TransactionRequest> {
        const recipient = params.recipient ?? DEVNET_NEON_TOKENS.usdc;
        const mode = params.simulationMode ?? "approval";

        if (mode === "transfer") {
            return {
                data: this.erc20Interface.encodeFunctionData("transfer", [recipient, params.amount]),
                from: params.from,
                to: params.tokenIn,
                value: 0n
            };
        }

        return {
            data: this.erc20Interface.encodeFunctionData("approve", [recipient, params.amount]),
            from: params.from,
            to: params.tokenIn,
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

    private async readErc20Decimals(tokenAddress: string): Promise<number> {
        const response = await this.provider.call({
            data: this.erc20Interface.encodeFunctionData("decimals"),
            to: tokenAddress
        });
        const [decimals] = this.erc20Interface.decodeFunctionResult("decimals", response);
        return Number(decimals);
    }

    private async readPrice(feedAddress: string): Promise<{ decimals: number; price: bigint }> {
        const [decimalsResponse, latestRoundDataResponse] = await Promise.all([
            this.provider.call({
                data: this.aggregatorInterface.encodeFunctionData("decimals"),
                to: feedAddress
            }),
            this.provider.call({
                data: this.aggregatorInterface.encodeFunctionData("latestRoundData"),
                to: feedAddress
            })
        ]);

        const [decimals] = this.aggregatorInterface.decodeFunctionResult("decimals", decimalsResponse);
        const [, price] = this.aggregatorInterface.decodeFunctionResult("latestRoundData", latestRoundDataResponse);
        return {
            decimals: Number(decimals),
            price: BigInt(price.toString())
        };
    }

    private resolveFeed(tokenAddress: string): string {
        const normalized = tokenAddress.toLowerCase();
        if (normalized === DEVNET_NEON_TOKENS.wsol.toLowerCase()) {
            return DEVNET_CHAINLINK_FEEDS["sol-usd"];
        }
        if (normalized === DEVNET_NEON_TOKENS.usdc.toLowerCase()) {
            return DEVNET_CHAINLINK_FEEDS["usdc-usd"];
        }
        throw new EvmAdapterError(`No Neon devnet price feed configured for token ${tokenAddress}`);
    }
}
