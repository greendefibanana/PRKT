export type MarketSnapshot = {
  buyThresholdUsd: number;
  solPriceUsd: number;
  usdcPriceUsd: number;
};

export class MockPriceFeed {
  constructor(private readonly snapshot: MarketSnapshot) {}

  read(): MarketSnapshot {
    return this.snapshot;
  }
}
