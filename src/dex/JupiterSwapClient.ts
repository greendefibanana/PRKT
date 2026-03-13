import { PublicKey } from "@solana/web3.js";

export type JupiterQuoteRoute = {
  inAmount: string;
  inputMint: string;
  outAmount: string;
  outputMint: string;
  priceImpactPct?: string;
  routePlan?: unknown[];
  slippageBps?: number;
};

type JupiterQuoteResponse = {
  data?: JupiterQuoteRoute[];
};

type JupiterSwapResponse = {
  swapTransaction?: string;
};

export class JupiterApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JupiterApiError";
  }
}

export class JupiterSwapClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async getQuote(input: {
    inputMint: string;
    outputMint: string;
    amount: bigint;
    slippageBps: number;
  }): Promise<JupiterQuoteRoute> {
    const params = new URLSearchParams({
      inputMint: input.inputMint,
      outputMint: input.outputMint,
      amount: input.amount.toString(),
      slippageBps: input.slippageBps.toString()
    });

    const response = await this.fetchImpl(`${this.baseUrl}/swap/v1/quote?${params.toString()}`);
    if (!response.ok) {
      throw new JupiterApiError(`Jupiter quote failed with HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as JupiterQuoteResponse;
    const route = payload.data?.[0];
    if (!route) {
      throw new JupiterApiError("Jupiter quote returned no routes.");
    }

    return route;
  }

  async buildSwapTransaction(input: {
    quoteResponse: JupiterQuoteRoute;
    userPublicKey: PublicKey;
  }): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}/swap/v1/swap`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        quoteResponse: input.quoteResponse,
        userPublicKey: input.userPublicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true
      })
    });

    if (!response.ok) {
      throw new JupiterApiError(`Jupiter swap build failed with HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as JupiterSwapResponse;
    if (!payload.swapTransaction) {
      throw new JupiterApiError("Jupiter swap response did not include a swapTransaction.");
    }

    return payload.swapTransaction;
  }
}
