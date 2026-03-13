import { JupiterSwapClient } from "../../src/dex/JupiterSwapClient";

describe("JupiterSwapClient", () => {
  it("fetches the first available route from the quote endpoint", async () => {
    const client = new JupiterSwapClient(
      "https://lite-api.jup.ag",
      jest.fn(async () =>
        ({
          ok: true,
          json: async () => ({
            data: [
              {
                inAmount: "10000000",
                inputMint: "So11111111111111111111111111111111111111112",
                outAmount: "999000",
                outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
              }
            ]
          })
        }) as Response
      )
    );

    const route = await client.getQuote({
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amount: 10_000_000n,
      slippageBps: 50
    });

    expect(route.outAmount).toBe("999000");
  });
});
