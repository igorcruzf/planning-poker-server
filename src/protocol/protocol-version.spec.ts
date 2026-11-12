import {
    isProtocolVersionSupported,
    parseProtocolVersion,
    readHandshakeProtocolVersion,
} from './protocol-version';

describe('parseProtocolVersion', () => {
    it('parses a major.minor version', () => {
        expect(parseProtocolVersion('1.0')).toEqual({ major: 1, minor: 0 });
        expect(parseProtocolVersion('1.10')).toEqual({ major: 1, minor: 10 });
    });

    it.each([undefined, null, 1, '', '1', '1.0.0', 'v1.0', ' 1.0', '01.0', '1.-1'])(
        'returns undefined for invalid value %p',
        (value) => {
            expect(parseProtocolVersion(value)).toBeUndefined();
        },
    );
});

describe('isProtocolVersionSupported', () => {
    it.each([
        ['1.3', '1.3', true],
        ['1.2', '1.3', true],
        ['1.1', '1.3', false],
        ['1.4', '1.3', false],
        ['2.3', '1.3', false],
        ['0.9', '1.0', false],
        ['1.0', '1.0', true],
        [undefined, '1.0', false],
    ])('client %p against server %p is supported: %p', (client, server, expected) => {
        expect(isProtocolVersionSupported(client, server)).toBe(expected);
    });

    it('throws when the server version is invalid', () => {
        expect(() => isProtocolVersionSupported('1.0', 'x')).toThrow(
            new Error('Invalid server protocol version: x'),
        );
    });
});

describe('readHandshakeProtocolVersion', () => {
    it('reads protocolVersion from the handshake auth payload', () => {
        expect(readHandshakeProtocolVersion({ auth: { protocolVersion: '1.0' } })).toBe('1.0');
    });

    it('returns undefined when auth has no protocolVersion', () => {
        expect(readHandshakeProtocolVersion({ auth: {} })).toBeUndefined();
    });

    it('returns undefined when the handshake has no auth', () => {
        expect(readHandshakeProtocolVersion({})).toBeUndefined();
    });
});
