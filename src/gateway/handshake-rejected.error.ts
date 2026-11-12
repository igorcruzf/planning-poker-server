export class HandshakeRejectedError extends Error {
    constructor(
        message: string,
        readonly data?: unknown,
    ) {
        super(message);
        this.name = HandshakeRejectedError.name;
    }
}
