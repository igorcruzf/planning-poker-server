import { isProtocolVersionSupported, parseProtocolVersion } from '../protocol/protocol-version';
import { connectErrorDataSchema, handshakeAuthSchema, PROTOCOL_VERSION, protocolVersionSchema } from '../contracts';

describe('protocol contract', () => {
    it('declares protocol version 1.0', () => {
        expect(PROTOCOL_VERSION).toBe('1.0');
    });

    it('is accepted by the protocol version parser', () => {
        expect(parseProtocolVersion(PROTOCOL_VERSION)).toEqual({ major: 1, minor: 0 });
    });

    it('is supported by a server running the same version', () => {
        expect(isProtocolVersionSupported(PROTOCOL_VERSION, PROTOCOL_VERSION)).toBe(true);
    });

    it('accepts a handshake auth carrying the protocol version', () => {
        expect(handshakeAuthSchema.parse({ protocolVersion: PROTOCOL_VERSION })).toEqual({
            protocolVersion: '1.0',
        });
    });

    it('rejects a handshake auth without protocolVersion', () => {
        expect(handshakeAuthSchema.safeParse({}).success).toBe(false);
    });

    it.each(['1.0', '1.10', '0.9', '', '1', '1.0.0', 'v1.0', ' 1.0', '01.0', 1, null, undefined])(
        'validates %p exactly like parseProtocolVersion',
        (value) => {
            expect(protocolVersionSchema.safeParse(value).success).toBe(parseProtocolVersion(value) !== undefined);
        },
    );

    it('describes the connect_error data sent when the client version is not supported', () => {
        const data = { code: 'protocol_version_unsupported', serverProtocolVersion: PROTOCOL_VERSION };

        expect(connectErrorDataSchema.parse(data)).toEqual(data);
        expect(connectErrorDataSchema.safeParse({ code: 'room_not_found', serverInstanceId: 'srv' }).success).toBe(
            false,
        );
    });
});
