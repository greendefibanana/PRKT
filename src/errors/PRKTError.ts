export class PRKTError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PRKTError";
    }
}

export class CompressionError extends PRKTError {
    constructor(message: string) {
        super(message);
        this.name = "CompressionError";
    }
}

export class AnchorError extends PRKTError {
    constructor(message: string) {
        super(message);
        this.name = "AnchorError";
    }
}

export class ProofError extends PRKTError {
    constructor(message: string) {
        super(message);
        this.name = "ProofError";
    }
}

export class EvmAdapterError extends PRKTError {
    constructor(message: string) {
        super(message);
        this.name = "EvmAdapterError";
    }
}
