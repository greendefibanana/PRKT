import { defaultPRKTConfig } from "../../src/config/PRKTConfig";
import { Keypair } from "@solana/web3.js";

const routeToEvmMock = jest.fn().mockResolvedValue({ signature: "0xsig" });
const neonBridgeCtor = jest.fn();
const uniswapCtor = jest.fn();
const aaveCtor = jest.fn();

jest.mock("../../src/evm/NeonWalletBridge", () => ({
  NeonWalletBridge: jest.fn().mockImplementation((rpcEndpoint: string) => {
    neonBridgeCtor(rpcEndpoint);
    return {
      deriveEvmWallet: jest.fn(),
      deriveEvmAddress: jest.fn(() => "0xAgentEvmAddress"),
      signEvmTransaction: jest.fn()
    };
  })
}));

jest.mock("../../src/evm/adapters/UniswapV3Adapter", () => ({
  UniswapV3Adapter: jest.fn().mockImplementation((rpcEndpoint: string) => {
    uniswapCtor(rpcEndpoint);
    return {
      swap: jest.fn().mockResolvedValue({
        to: "0xUniswap",
        value: 0n
      })
    };
  })
}));

jest.mock("../../src/evm/adapters/AaveAdapter", () => ({
  AaveAdapter: jest.fn().mockImplementation((rpcEndpoint: string) => {
    aaveCtor(rpcEndpoint);
    return {
      borrow: jest.fn().mockResolvedValue({
        to: "0xAave",
        value: 0n
      })
    };
  })
}));

import { UniversalDeFiOrchestrator } from "../../src/defi/universal/UniversalDeFiOrchestrator";

describe("UniversalDeFiOrchestrator EVM routing", () => {
  const originalEvmEnabled = defaultPRKTConfig.evmAdapters.enabled;
  const originalNeonRpc = defaultPRKTConfig.evmAdapters.neonRpcEndpoint;
  const originalCompressionRpc = defaultPRKTConfig.zkCompression.rpcEndpoint;
  const originalNeonBroadcastEnabled = process.env.NEON_BROADCAST_ENABLED;

  beforeEach(() => {
    routeToEvmMock.mockClear();
    neonBridgeCtor.mockClear();
    uniswapCtor.mockClear();
    aaveCtor.mockClear();
    defaultPRKTConfig.evmAdapters.enabled = true;
    defaultPRKTConfig.evmAdapters.neonRpcEndpoint = "https://devnet.neonevm.org";
    defaultPRKTConfig.zkCompression.rpcEndpoint = "https://compression.example.invalid";
    process.env.NEON_BROADCAST_ENABLED = "1";
  });

  afterAll(() => {
    defaultPRKTConfig.evmAdapters.enabled = originalEvmEnabled;
    defaultPRKTConfig.evmAdapters.neonRpcEndpoint = originalNeonRpc;
    defaultPRKTConfig.zkCompression.rpcEndpoint = originalCompressionRpc;
    if (originalNeonBroadcastEnabled === undefined) {
      delete process.env.NEON_BROADCAST_ENABLED;
    } else {
      process.env.NEON_BROADCAST_ENABLED = originalNeonBroadcastEnabled;
    }
  });

  it("uses the Neon RPC endpoint for uniswap requests", async () => {
    const payer = Keypair.generate();
    const orchestrator = new UniversalDeFiOrchestrator({
      koraSigner: {} as never,
      walletManager: {
        payer,
        source: "generated"
      } as never
    });
    const liveExecutor = {
      executePreparedEvmTransaction: routeToEvmMock
    };

    await orchestrator.execute(
      {
        capability: "SWAP" as never,
        params: {
          amount: 1n,
          tokenIn: "0x512E48836Cd42F3eB6f50CEd9ffD81E0a7F15103",
          tokenOut: "0xc7Fc9b46e479c5Cb42f6C458D1881e55E6B7986c"
        } as never,
        protocol: "uniswap-v3" as never,
        snapshot: {} as never
      } as never,
      { liveExecutor: liveExecutor as never }
    );

    expect(neonBridgeCtor).toHaveBeenCalledWith("https://devnet.neonevm.org");
    expect(uniswapCtor).toHaveBeenCalledWith("https://devnet.neonevm.org");
    expect(aaveCtor).not.toHaveBeenCalled();
  });

  it("uses the Neon RPC endpoint for aave requests", async () => {
    const payer = Keypair.generate();
    const orchestrator = new UniversalDeFiOrchestrator({
      koraSigner: {} as never,
      walletManager: {
        payer,
        source: "generated"
      } as never
    });
    const liveExecutor = {
      executePreparedEvmTransaction: routeToEvmMock
    };

    await orchestrator.execute(
      {
        capability: "BORROW" as never,
        params: {
          amount: 1n,
          asset: "0x512E48836Cd42F3eB6f50CEd9ffD81E0a7F15103"
        } as never,
        protocol: "aave" as never,
        snapshot: {} as never
      } as never,
      { liveExecutor: liveExecutor as never }
    );

    expect(neonBridgeCtor).toHaveBeenCalledWith("https://devnet.neonevm.org");
    expect(aaveCtor).toHaveBeenCalledWith("https://devnet.neonevm.org");
    expect(uniswapCtor).not.toHaveBeenCalled();
  });

  it("fails closed when Neon broadcast is disabled", async () => {
    delete process.env.NEON_BROADCAST_ENABLED;
    const payer = Keypair.generate();
    const logger = jest.fn();
    const orchestrator = new UniversalDeFiOrchestrator({
      koraSigner: {} as never,
      logger,
      walletManager: {
        payer,
        source: "generated"
      } as never
    });

    const result = await orchestrator.execute(
      {
        capability: "SWAP" as never,
        params: {
          amount: 1n,
          tokenIn: "0x512E48836Cd42F3eB6f50CEd9ffD81E0a7F15103",
          tokenOut: "0xc7Fc9b46e479c5Cb42f6C458D1881e55E6B7986c"
        } as never,
        protocol: "uniswap-v3" as never,
        snapshot: {} as never
      } as never,
      { liveExecutor: { executePreparedEvmTransaction: routeToEvmMock } as never }
    );

    expect(result.result).toBeNull();
    expect(routeToEvmMock).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith(expect.stringContaining("NEON_BROADCAST_ENABLED"));
  });
});
