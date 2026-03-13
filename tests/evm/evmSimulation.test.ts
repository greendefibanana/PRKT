import { Keypair } from "@solana/web3.js";

import { defaultPRKTConfig } from "../../src/config/PRKTConfig";
import { UniswapV3Adapter } from "../../src/evm/adapters/UniswapV3Adapter";

const describeDevnet = process.env.PRKT_RUN_DEVNET_TESTS === "1" ? describe : describe.skip;

const DEVNET_WSOL = "0xc7Fc9b46e479c5Cb42f6C458D1881e55E6B7986c";
const DEVNET_USDC = "0x512E48836Cd42F3eB6f50CEd9ffD81E0a7F15103";

describeDevnet("Neon EVM simulation", () => {
  jest.setTimeout(30_000);

  it("calls UniswapV3Adapter.simulateSwap against Neon devnet and returns a structured SimulationResult", async () => {
    const adapter = new UniswapV3Adapter(defaultPRKTConfig.evmAdapters.neonRpcEndpoint);
    const simulation = await adapter.simulateSwap({
      amount: 1_000_000n,
      from: `0x${Buffer.from(Keypair.generate().publicKey.toBytes()).toString("hex").slice(0, 40)}`,
      simulationMode: "approval",
      slippage: 1,
      tokenIn: DEVNET_USDC,
      tokenOut: DEVNET_WSOL
    });

    expect(simulation.success).toBe(true);
    expect(simulation.gasEstimate).toEqual(expect.any(BigInt));
  });

  it("returns a revert path when simulateSwap checks an unfunded transfer on Neon devnet", async () => {
    const adapter = new UniswapV3Adapter(defaultPRKTConfig.evmAdapters.neonRpcEndpoint);
    const simulation = await adapter.simulateSwap({
      amount: 1_000_000n,
      from: `0x${Buffer.from(Keypair.generate().publicKey.toBytes()).toString("hex").slice(0, 40)}`,
      recipient: DEVNET_WSOL,
      simulationMode: "transfer",
      slippage: 1,
      tokenIn: DEVNET_USDC,
      tokenOut: DEVNET_WSOL
    });

    expect(simulation.success).toBe(false);
    expect(simulation.revertReason).toEqual(expect.any(String));
  });
});
