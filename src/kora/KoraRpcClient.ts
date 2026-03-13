type JsonRpcSuccess<T> = {
  id: string | number | null;
  jsonrpc: "2.0";
  result: T;
};

type JsonRpcFailure = {
  id: string | number | null;
  jsonrpc: "2.0";
  error: {
    code: number;
    message: string;
  };
};

type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcFailure;

export class KoraRpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KoraRpcError";
  }
}

export class KoraRpcClient {
  constructor(
    private readonly endpoint: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  get rpcUrl(): string {
    return this.endpoint;
  }

  async getBlockhash(): Promise<string> {
    const result = await this.call<{ blockhash?: string; value?: { blockhash?: string } }>(
      "getBlockhash",
      []
    );

    const blockhash = result.blockhash ?? result.value?.blockhash;
    if (!blockhash) {
      throw new KoraRpcError("Kora getBlockhash response did not include a blockhash.");
    }

    return blockhash;
  }

  async signAndSendTransaction(transaction: string): Promise<{ signature: string }> {
    const result = await this.call<{ signature?: string; txid?: string }>(
      "signAndSendTransaction",
      [{ transaction }]
    );

    const signature = result.signature ?? result.txid;
    if (!signature) {
      throw new KoraRpcError("Kora signAndSendTransaction response did not include a signature.");
    }

    return { signature };
  }

  private async call<T>(method: string, params: unknown[]): Promise<T> {
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: method,
        method,
        params
      })
    });

    if (!response.ok) {
      throw new KoraRpcError(`Kora RPC request failed with HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as JsonRpcResponse<T>;
    if ("error" in payload) {
      throw new KoraRpcError(`Kora RPC error ${payload.error.code}: ${payload.error.message}`);
    }

    return payload.result;
  }
}
