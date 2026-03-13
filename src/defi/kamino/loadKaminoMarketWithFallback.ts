import { address, createSolanaRpc, type Address } from "@solana/kit";
import {
  DEFAULT_RECENT_SLOT_DURATION_MS,
  Fraction,
  KaminoMarket,
  KaminoReserve,
  LendingMarket,
  getReserveStatesForMarket,
  type TokenOracleData
} from "@kamino-finance/klend-sdk";
import Decimal from "decimal.js";

import { fetchKaminoCdnData } from "@kamino-finance/klend-sdk/dist/utils/readCdnData";

type Cluster = "devnet" | "localnet" | "mainnet-beta" | "testnet" | "unknown";

export async function loadKaminoMarketWithFallback(input: {
  cluster: Cluster;
  logger?: (message: string) => void;
  marketAddress: Address;
  programAddress: Address;
  rpcUrl: string;
}): Promise<KaminoMarket> {
  const rpc = createSolanaRpc(input.rpcUrl);

  if (input.cluster !== "devnet") {
    const market = await KaminoMarket.load(
      rpc,
      input.marketAddress,
      DEFAULT_RECENT_SLOT_DURATION_MS,
      input.programAddress
    );
    if (!market) {
      throw new Error(`Kamino market ${input.marketAddress} could not be loaded from ${input.rpcUrl}.`);
    }

    return market;
  }

  input.logger?.(
    "loading Kamino devnet market via reserve-state compatibility path (fallback reserve prices)"
  );

  const [marketState, reserveStates, cdnResourcesData] = await Promise.all([
    LendingMarket.fetch(rpc, input.marketAddress, input.programAddress),
    getReserveStatesForMarket(input.marketAddress, rpc, input.programAddress),
    fetchKaminoCdnData()
  ]);

  if (!marketState) {
    throw new Error(`Kamino market ${input.marketAddress} could not be loaded from ${input.rpcUrl}.`);
  }

  const mintAddresses = reserveStates.map((reserve) => reserve.state.liquidity.mintPubkey);
  const mintAccounts = (await rpc.getMultipleAccounts(mintAddresses).send()).value;
  const mintOwners = new Map<Address, Address>();
  mintAddresses.forEach((mintAddress, index) => {
    const mintAccount = mintAccounts[index];
    if (mintAccount) {
      mintOwners.set(mintAddress, mintAccount.owner);
    }
  });

  const reserves = new Map<Address, KaminoReserve>();
  for (const reserveWithAddress of reserveStates) {
    const normalizedReserveState = normalizeReserveTokenProgram(
      reserveWithAddress.state,
      mintOwners.get(reserveWithAddress.state.liquidity.mintPubkey)
    );
    const reserve = KaminoReserve.initialize(
      reserveWithAddress.address,
      normalizedReserveState,
      createFallbackOracleData(normalizedReserveState),
      rpc,
      DEFAULT_RECENT_SLOT_DURATION_MS,
      cdnResourcesData
    );
    reserves.set(reserve.address, reserve);
  }

  return KaminoMarket.loadWithReserves(
    rpc,
    marketState,
    reserves,
    input.marketAddress,
    DEFAULT_RECENT_SLOT_DURATION_MS,
    input.programAddress
  );
}

function createFallbackOracleData(
  reserveState: Awaited<ReturnType<typeof getReserveStatesForMarket>>[number]["state"]
): TokenOracleData {
  const marketPrice = new Fraction(reserveState.liquidity.marketPriceSf).toDecimal();
  const price = marketPrice.greaterThan(0) ? marketPrice : new Decimal(1);

  return {
    decimals: Decimal.pow(10, reserveState.liquidity.mintDecimals.toString()),
    mintAddress: reserveState.liquidity.mintPubkey,
    price,
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    valid: true
  };
}

function normalizeReserveTokenProgram<
  TReserve extends Awaited<ReturnType<typeof getReserveStatesForMarket>>[number]["state"]
>(reserveState: TReserve, mintOwner: Address | undefined): TReserve {
  if (!mintOwner || reserveState.liquidity.tokenProgram !== address("11111111111111111111111111111111")) {
    return reserveState;
  }

  return {
    ...reserveState,
    liquidity: {
      ...reserveState.liquidity,
      tokenProgram: mintOwner
    }
  };
}
