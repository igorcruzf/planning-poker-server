import { IncomingMessage } from 'node:http';
import { Socket } from 'socket.io';
import {
    DEFAULT_TRUSTED_PROXY_HOPS,
    clientAddressOf,
    clientAddressOfRequest,
    parseTrustedProxyHops,
    resolveClientAddress,
} from './client-address';

const socketWith = (headers: Record<string, string | string[]>, address = '10.0.0.9') =>
    ({ handshake: { headers, address } }) as unknown as Pick<Socket, 'handshake'>;
const requestWith = (headers: Record<string, string | string[]>, remoteAddress = '10.0.0.9') =>
    ({ headers, socket: { remoteAddress } }) as unknown as Pick<IncomingMessage, 'headers' | 'socket'>;

describe('parseTrustedProxyHops', () => {
    it.each([
        ['0', 0],
        ['1', 1],
        ['3', 3],
        ['5', 5],
        [' 2 ', 2],
    ])('accepts %p', (raw, expected) => {
        expect(parseTrustedProxyHops(raw, jest.fn())).toBe(expected);
    });

    it.each([undefined, ''])('uses the default for %p without warning', (raw) => {
        const warn = jest.fn();
        expect(parseTrustedProxyHops(raw, warn)).toBe(DEFAULT_TRUSTED_PROXY_HOPS);
        expect(warn).not.toHaveBeenCalled();
    });

    it.each(['6', '-1', '1.5', 'abc', '1e1', '0x2', '99999999999999999999'])(
        'falls back to the default and warns for %p',
        (raw) => {
            const warn = jest.fn();
            expect(parseTrustedProxyHops(raw, warn)).toBe(DEFAULT_TRUSTED_PROXY_HOPS);
            expect(warn).toHaveBeenCalledTimes(1);
        },
    );
});

describe('resolveClientAddress', () => {
    const chain = '6.6.6.6, 203.0.113.7, 10.1.1.1';

    it('defaults to one trusted hop', () => {
        expect(DEFAULT_TRUSTED_PROXY_HOPS).toBe(1);
    });

    it.each([
        [0, '10.0.0.9'],
        [1, '10.1.1.1'],
        [2, '203.0.113.7'],
        [3, '6.6.6.6'],
    ])('with %i hops picks the entry counted from the right', (hops, expected) => {
        expect(resolveClientAddress(chain, '10.0.0.9', hops)).toBe(expected);
    });

    it('falls back to the socket address when the header has fewer entries than hops', () => {
        expect(resolveClientAddress('203.0.113.7', '10.0.0.9', 2)).toBe('10.0.0.9');
        expect(resolveClientAddress(chain, '10.0.0.9', 4)).toBe('10.0.0.9');
    });

    it('ignores a forged leftmost entry when there are more entries than hops', () => {
        expect(resolveClientAddress('1.2.3.4, 5.6.7.8, 203.0.113.7', '10.0.0.9', 1)).toBe('203.0.113.7');
    });

    it.each([undefined, '', '   ', ',', '203.0.113.7,', ', ,'])(
        'falls back to the socket for the header %p',
        (header) => {
            expect(resolveClientAddress(header, '10.0.0.9', 1)).toBe('10.0.0.9');
        },
    );

    it.each(['not-an-ip', 'a'.repeat(500), '1.2.3.4:80', '<script>', '999.1.1.1'])(
        'falls back to the socket when the chosen entry is malformed (%p)',
        (entry) => {
            expect(resolveClientAddress(`203.0.113.7, ${entry}`, '10.0.0.9', 1)).toBe('10.0.0.9');
        },
    );

    it('accepts IPv6 entries and joins header arrays', () => {
        expect(resolveClientAddress(['6.6.6.6', '2001:db8::1'], '10.0.0.9', 1)).toBe('2001:db8::1');
    });

    it('limits the size of the socket address', () => {
        expect(resolveClientAddress(undefined, 'a'.repeat(500), 1)).toHaveLength(64);
    });

    it('answers unknown without any address', () => {
        expect(resolveClientAddress(undefined, undefined, 1)).toBe('unknown');
    });
});

describe('configured address helpers', () => {
    it('uses the handshake address without a proxy header', () => {
        expect(clientAddressOf(socketWith({}))).toBe('10.0.0.9');
        expect(clientAddressOfRequest(requestWith({}))).toBe('10.0.0.9');
    });

    it('uses the last x-forwarded-for entry with the default hop', () => {
        const headers = { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' };
        expect(clientAddressOf(socketWith(headers))).toBe('203.0.113.7');
        expect(clientAddressOfRequest(requestWith(headers))).toBe('203.0.113.7');
    });

    describe('with TRUSTED_PROXY_HOPS in the environment', () => {
        const headers = { 'x-forwarded-for': '6.6.6.6, 203.0.113.7, 10.1.1.1' };
        const original = process.env.TRUSTED_PROXY_HOPS;

        afterEach(() => {
            if (original === undefined) delete process.env.TRUSTED_PROXY_HOPS;
            else process.env.TRUSTED_PROXY_HOPS = original;
        });

        it.each([
            ['0', '10.0.0.9'],
            ['2', '203.0.113.7'],
            ['invalid', '10.1.1.1'],
        ])('reads %p', (value, expected) => {
            process.env.TRUSTED_PROXY_HOPS = value;
            expect(clientAddressOf(socketWith(headers))).toBe(expected);
            expect(clientAddressOfRequest(requestWith(headers))).toBe(expected);
        });
    });
});
