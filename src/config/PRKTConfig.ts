export interface PRKTConfig {
    zkCompression: {
        enabled: boolean;
        rpcEndpoint: string;
    };
    dataAnchoring: {
        enabled: boolean;
    };
    zkPolicyProofs: {
        enabled: boolean;
    };
    evmAdapters: {
        enabled: boolean;
        neonRpcEndpoint: string;
    };
}

export const defaultPRKTConfig: PRKTConfig = {
    zkCompression: {
        enabled: false,
        rpcEndpoint: "https://devnet.helius-rpc.com/?api-key=" // Default placeholder or use env later
    },
    dataAnchoring: {
        enabled: false
    },
    zkPolicyProofs: {
        enabled: false
    },
    evmAdapters: {
        enabled: false,
        neonRpcEndpoint: "https://devnet.neonevm.org"
    }
};
