export interface ProtocolVersion {
    major: number;
    minor: number;
}

const PROTOCOL_VERSION_PATTERN = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;

export const parseProtocolVersion = (value: unknown): ProtocolVersion | undefined => {
    if (typeof value !== 'string') {
        return undefined;
    }
    const match = PROTOCOL_VERSION_PATTERN.exec(value);
    if (!match) {
        return undefined;
    }
    return { major: Number(match[1]), minor: Number(match[2]) };
};

export const isProtocolVersionSupported = (client: unknown, server: string): boolean => {
    const serverVersion = parseProtocolVersion(server);
    if (!serverVersion) {
        throw new Error(`Invalid server protocol version: ${server}`);
    }
    const clientVersion = parseProtocolVersion(client);
    if (!clientVersion || clientVersion.major !== serverVersion.major) {
        return false;
    }
    return clientVersion.minor === serverVersion.minor || clientVersion.minor === serverVersion.minor - 1;
};

export const readHandshakeProtocolVersion = (handshake: { auth?: Record<string, unknown> }): unknown =>
    handshake.auth?.protocolVersion;
